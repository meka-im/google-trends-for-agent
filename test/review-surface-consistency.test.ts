import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compareTrends, queryTrends, type TrendsResponse } from '../src/api.js';
import { runAskCli } from '../src/ask-cli.js';
import { resolveFilter, type TrendsFilter } from '../src/filter.js';
import { runSnapshotCli } from '../src/snapshot-cli.js';
import { SnapshotStore, type TermSnapshot } from '../src/snapshot.js';
import { createTools } from '../src/tools.js';
import type { Transport } from '../src/transport.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const meta = () => ({
  upstreamRequests: 1,
  durationMs: 0,
  warnings: [] as string[],
  fetchedAt: new Date().toISOString(),
});

function success(input: unknown): TrendsResponse {
  const queries = (input as { queries?: unknown } | undefined)?.queries;
  const width = Array.isArray(queries) ? Math.max(1, queries.length) : 1;
  return {
    status: 'ok',
    input,
    data: {
      interestOverTime: {
        timeline: Array.from({ length: 12 }, (_, index) => ({
          time: new Date(Date.UTC(2026, 0, 1, index)).toISOString(),
          formattedTime: `Jan ${index + 1}`,
          values: Array.from({ length: width }, () => 20 + index),
          formattedValues: Array.from({ length: width }, () => String(20 + index)),
          hasData: Array.from({ length: width }, () => true),
          isPartial: false,
        })),
        averages: null,
      },
      relatedQueries: { top: [], rising: [] },
      interestBySubregion: { resolution: 'COUNTRY', valueMode: 'RELATIVE', rows: [], omittedNoDataRows: 0 },
    },
    meta: meta(),
  };
}

function storedSnapshot(
  id: string,
  term: string,
  filter: TrendsFilter,
  fetchedAt: string,
): TermSnapshot {
  const points = Array.from({ length: 12 }, (_, index) => ({
    time: new Date(Date.parse(fetchedAt) + index * 60_000).toISOString(),
    value: 20 + index,
  }));
  return {
    schema: 'term-snapshot/1',
    id,
    term,
    filter,
    fetchedAt,
    status: 'ok',
    interest: {
      points,
      latest: points.at(-1)!.value,
      peak: Math.max(...points.map(point => point.value)),
      settledLatest: points.at(-2)!.value,
    },
    popular: [{ rank: 1, query: `${term} related`, value: 50 }],
    rising: [],
    regions: [],
  };
}

function failedSnapshot(
  id: string,
  term: string,
  filter: TrendsFilter,
  fetchedAt: string,
): TermSnapshot {
  return {
    ...storedSnapshot(id, term, filter, fetchedAt),
    status: 'error',
    error: { code: 'TRENDS_PROTOCOL_CHANGED', message: 'newer failed diagnostic' },
    interest: { points: [], latest: 0, peak: 0, settledLatest: 0 },
    popular: [],
    rising: [],
    regions: [],
  };
}

async function seedSuccessfulHistory(store: SnapshotStore, term: string, filter: TrendsFilter) {
  const now = Date.now();
  const previous = storedSnapshot('previous-success', term, filter, new Date(now - 3_600_000).toISOString());
  const current = storedSnapshot('current-success', term, filter, new Date(now).toISOString());
  await store.save(previous);
  await store.save(current);
  return { previous, current };
}

describe('validation snapshot identity', () => {
  it.each([['never'], ['default']] as const)(
    'keeps repeated lead metadata and diffs the selected success snapshot with refresh %s',
    async refresh => {
      const store = new SnapshotStore(tempDir('gtfa-review-snapshot-id-cli-'));
      const filter = resolveFilter({});
      const { previous, current } = await seedSuccessfulHistory(store, 'Sora', filter);
      const diagnostic = failedSnapshot(
        'newer-failed-diagnostic',
        'Sora',
        filter,
        new Date(Date.now() + 60_000).toISOString(),
      );
      let inserted = false;
      const query = vi.fn<typeof queryTrends>(async input => {
        if ((input as { queries: string[] }).queries.length > 1 && !inserted) {
          inserted = true;
          await store.save(diagnostic);
        }
        return success(input);
      });
      const leads = [
        { name: 'Sora', source: 'first-source', url: 'https://example.test/first' },
        { name: 'Sora', source: 'second-source', firstSeen: '2026-11-14' },
      ];
      const result = await runAskCli([
        '--validate', '--from', '-', '--json', '--store', store.dir,
        ...(refresh === 'never' ? ['--refresh', 'never'] : []),
      ], {
        stdin: JSON.stringify(leads),
        query,
        baselines: { version: 2, anchors: [] },
      });
      expect(result.code).toBe(0);
      const output = JSON.parse(result.stdout) as Array<{
        input: unknown;
        diff: { from?: string; to?: string };
        meta: { snapshotId?: string };
      }>;
      expect(output).toHaveLength(2);
      for (const [index, envelope] of output.entries()) {
        expect(envelope.input).toEqual(leads[index]);
        expect(envelope.meta.snapshotId).toBe(current.id);
        expect(envelope.diff).toMatchObject({ from: previous.id, to: current.id });
      }
      expect((await store.latest('Sora', filter))?.id).toBe(diagnostic.id);
    },
  );

  it('uses the validation row snapshotId in trends_ask instead of the newest failed diagnostic', async () => {
    const store = new SnapshotStore(tempDir('gtfa-review-snapshot-id-tool-'));
    const filter: TrendsFilter = { geo: 'US', time: 'now 1-d', category: 0, property: '' };
    const { previous, current } = await seedSuccessfulHistory(store, 'Sora', filter);
    const diagnostic = failedSnapshot(
      'newer-failed-diagnostic',
      'Sora',
      filter,
      new Date(Date.now() + 60_000).toISOString(),
    );
    let inserted = false;
    let multilineRequests = 0;
    let comparisonTerms = ['chatgpt', 'claude'];
    const transport: Transport = async request => {
      if (request.method === 'HEAD') return { status: 200, headers: {}, body: '' };
      if (request.url.includes('/explore')) {
        const rawRequest = new URL(request.url).searchParams.get('req');
        if (rawRequest) {
          const parsed = JSON.parse(rawRequest) as { comparisonItem?: Array<{ keyword?: string }> };
          comparisonTerms = (parsed.comparisonItem ?? []).map(item => item.keyword ?? '');
        }
        const body = readFileSync(new URL('./fixtures/explore-multi.txt', import.meta.url), 'utf8')
          .replaceAll('chatgpt', comparisonTerms[0] ?? 'chatgpt')
          .replaceAll('claude', comparisonTerms[1] ?? 'claude');
        return { status: 200, headers: {}, body };
      }
      if (request.url.includes('/multiline')) {
        multilineRequests += 1;
        if (!inserted) {
          inserted = true;
          await store.save(diagnostic);
        }
        return { status: 200, headers: {}, body: readFileSync(new URL('./fixtures/multiline-multi.txt', import.meta.url), 'utf8') };
      }
      throw new Error(`unexpected request: ${request.url}`);
    };
    const ask = createTools({
      transport,
      minIntervalMs: 0,
      snapshotDir: store.dir,
      chartDir: null,
    }).find(tool => tool.name === 'trends_ask')!;
    const result = await ask.execute({ term: 'Sora', validate: true });
    expect(result).toMatchObject({
      meta: { snapshotId: current.id },
      diff: { from: previous.id, to: current.id },
    });
    expect(comparisonTerms).toEqual(['Sora', 'sudoku']);
    expect(multilineRequests).toBeGreaterThan(0);
    expect(inserted).toBe(true);
    expect((await store.latest('Sora', filter))?.id).toBe(diagnostic.id);
  });
});

describe('surface consistency', () => {
  it('passes timeoutSurface as a client option rather than query input', async () => {
    const result = await compareTrends(['Sora'], {
      timeoutSurface: 'tool',
      maxRetries: 0,
      minIntervalMs: 0,
      transport: async () => { throw new DOMException('timeout', 'TimeoutError'); },
    });
    expect(result.error).toMatchObject({
      code: 'TRENDS_TIMEOUT',
      message: expect.stringContaining('raise timeoutMs'),
    });
    expect(result.meta.upstreamRequests).toBe(1);
  });

  it('returns 2 for partial snapshot output while retaining no_data success semantics', async () => {
    const partialQuery: typeof queryTrends = async input => ({ ...success(input), status: 'partial' });
    const partial = await runSnapshotCli([
      'Sora', '--json', '--fresh', '--store', tempDir('gtfa-review-partial-'),
    ], {
      query: partialQuery,
      baselines: { version: 2, anchors: [] },
      chartDir: null,
    });
    expect(partial.code).toBe(2);
    expect(JSON.parse(partial.stdout)).toMatchObject({ ok: true, status: 'partial' });

    const noDataQuery: typeof queryTrends = async input => {
      const response = success(input);
      const data = response.data as {
        interestOverTime: { timeline: Array<{ values: number[]; formattedValues: string[] }> };
      } & Record<string, unknown>;
      for (const point of data.interestOverTime.timeline) {
        point.values = point.values.map(() => 0);
        point.formattedValues = point.formattedValues.map(() => '0');
      }
      return response;
    };
    const noData = await runSnapshotCli([
      'Zero', '--json', '--fresh', '--store', tempDir('gtfa-review-no-data-'),
    ], {
      query: noDataQuery,
      baselines: { version: 2, anchors: [] },
      chartDir: null,
    });
    expect(noData.code).toBe(0);
    expect(JSON.parse(noData.stdout)).toMatchObject({ ok: true, status: 'no_data' });
  });
});

const tsxImport = import.meta.resolve('tsx');
const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const cliFetchPath = fileURLToPath(new URL('./cli-fetch.mjs', import.meta.url));

function runCli(args: string[], cwd: string) {
  const capture = tempDir('gtfa-review-cli-output-');
  const stdoutPath = join(capture, 'stdout');
  const stderrPath = join(capture, 'stderr');
  const stdout = openSync(stdoutPath, 'w');
  const stderr = openSync(stderrPath, 'w');
  try {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HTTPS_PROXY: '',
      https_proxy: '',
      HTTP_PROXY: '',
      http_proxy: '',
    };
    delete env.GTFA_GEO;
    delete env.GTFA_TIME;
    const result = spawnSync(process.execPath, [
      '--import', tsxImport,
      '--import', cliFetchPath,
      cliPath,
      ...args,
    ], { cwd, env, stdio: ['ignore', stdout, stderr], timeout: 20_000 });
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: readFileSync(stdoutPath, 'utf8'),
      stderr: readFileSync(stderrPath, 'utf8'),
    };
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

describe('local CLI query filters', () => {
  it('uses configured category, property, and locale as defaults', () => {
    const cwd = tempDir('gtfa-review-cli-defaults-');
    writeFileSync(join(cwd, 'gtfa.config.json'), JSON.stringify({
      filter: { geo: 'gb', time: 'now 7-d', category: 45, property: 'news', hl: 'fr' },
    }));
    const result = runCli(['--query', 'coffee', '--format', 'json'], cwd);
    expect(result.status).not.toBe(4);
    expect(JSON.parse(result.stdout).input).toMatchObject({
      geo: 'GB',
      timeRange: 'now 7-d',
      category: 45,
      searchType: 'news',
      locale: 'fr',
    });
  });

  it('lets URL filters and explicit parameters override configured defaults', () => {
    const cwd = tempDir('gtfa-review-cli-overrides-');
    writeFileSync(join(cwd, 'gtfa.config.json'), JSON.stringify({
      filter: { geo: 'gb', time: 'now 7-d', category: 45, property: 'news', hl: 'fr' },
    }));
    const minimalUrl = new URL('https://trends.google.com/trends/explore');
    minimalUrl.searchParams.set('q', 'coffee');
    const minimal = runCli(['--url', minimalUrl.toString(), '--format', 'json'], cwd);
    expect(minimal.status).not.toBe(4);
    expect(JSON.parse(minimal.stdout).results[0].input).toMatchObject({
      geo: '',
      timeRange: 'today 12-m',
      category: 0,
      searchType: 'web',
      locale: 'en-US',
    });

    const explicitUrl = new URL('https://trends.google.com/trends/explore');
    explicitUrl.searchParams.set('q', 'coffee');
    explicitUrl.searchParams.set('geo', 'CA');
    explicitUrl.searchParams.set('date', 'now 7-d');
    explicitUrl.searchParams.set('cat', '0');
    explicitUrl.searchParams.set('gprop', '');
    explicitUrl.searchParams.set('hl', 'en-US');
    const fromUrl = runCli(['--url', explicitUrl.toString(), '--format', 'json'], cwd);
    expect(JSON.parse(fromUrl.stdout).results[0].input).toMatchObject({
      geo: 'CA',
      timeRange: 'now 7-d',
      category: 0,
      searchType: 'web',
      locale: 'en-US',
    });

    const explicit = runCli([
      '--query', 'coffee', '--geo', 'ca', '--time', 'today 3-m', '--format', 'json',
    ], cwd);
    expect(JSON.parse(explicit.stdout).input).toMatchObject({
      geo: 'CA',
      timeRange: 'today 3-m',
      category: 45,
      searchType: 'news',
      locale: 'fr',
    });

    const dated = runCli([
      '--query', 'coffee', '--start', '2026-01-01', '--end', '2026-02-01', '--format', 'json',
    ], cwd);
    const datedInput = JSON.parse(dated.stdout).input as Record<string, unknown>;
    expect(datedInput).toMatchObject({
      geo: 'GB',
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      category: 45,
      searchType: 'news',
      locale: 'fr',
    });
    expect(datedInput).not.toHaveProperty('timeRange');
  }, 20_000);

  it('detects --json before parseArgs so unknown flags still return the schema envelope', () => {
    const result = runCli(['--unknown', '--json'], tempDir('gtfa-review-cli-invalid-'));
    expect(result.status).toBe(4);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      schemaVersion: 1,
      status: 'error',
      error: { code: 'INVALID_INPUT' },
    });
    expect(result.stderr).toContain('INVALID_INPUT');
  });
});
