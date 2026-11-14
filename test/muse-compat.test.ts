import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetch as undiciFetch } from 'undici';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrendsClient } from '../src/client.js';
import { createDefaultTransport } from '../src/transport.js';
import { runAskCli } from '../src/ask-cli.js';
import type { queryTrends } from '../src/api.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryStore(): string {
  const directory = mkdtempSync(join(tmpdir(), 'gtfa-muse-compat-'));
  temporaryDirectories.push(directory);
  return directory;
}

function successfulQuery() {
  const timeline = Array.from({ length: 12 }, (_, index) => ({
    time: new Date(Date.UTC(2026, 10, 14, index)).toISOString(),
    values: [10 + index],
  }));
  return vi.fn<typeof queryTrends>(async input => ({
    status: 'ok',
    input,
    data: {
      interestOverTime: { timeline, averages: [15.5] },
      relatedQueries: { top: [], rising: [] },
      interestBySubregion: { rows: [] },
    },
    meta: { fetchedAt: new Date(Date.UTC(2026, 10, 14, 12)).toISOString(), upstreamRequests: 3, durationMs: 1000, warnings: [] },
  }));
}

describe('Muse VM friction compatibility', () => {
  it('allows one Explore request to take nine seconds under the default timeout', async () => {
    for (const key of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) vi.stubEnv(key, '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(undiciFetch as typeof fetch);
    let exploreDelayed = false;
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'HEAD') {
        response.writeHead(200, { 'set-cookie': 'NID=local; Path=/' });
        response.end();
        return;
      }
      if (requestUrl.pathname.endsWith('/explore')) {
        exploreDelayed = true;
        setTimeout(() => {
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end(fixture('explore-single-world.txt'));
        }, 9000);
        return;
      }
      if (requestUrl.pathname.endsWith('/multiline')) {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(fixture('multiline-single-custom.txt'));
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('local fixture server did not expose a TCP address');
      const localOrigin = `http://127.0.0.1:${address.port}`;
      const underlying = createDefaultTransport({});
      const client = new TrendsClient({
        transport: request => {
          const requestUrl = new URL(request.url);
          return underlying({ ...request, url: localOrigin + requestUrl.pathname + requestUrl.search });
        },
        minIntervalMs: 0,
      });
      const result = await client.query({ queries: ['bitcoin'], dataTypes: ['interestOverTime'], maxRetries: 0 });
      expect(exploreDelayed).toBe(true);
      expect(result.status).toBe('ok');
      expect(result.error).toBeUndefined();
      expect((result.data.interestOverTime as { timeline: unknown[] }).timeline.length).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
      fetchSpy.mockRestore();
    }
  }, 25000);
});

describe('ask CLI pretty output', () => {
  it('indents ordinary JSON while validate keeps its table without --json', async () => {
    const store = temporaryStore();
    const query = successfulQuery();
    const ordinary = await runAskCli(['coffee', '--fresh', '--pretty', '--store', store], { query });
    expect(ordinary.code).toBe(0);
    expect(ordinary.stdout.startsWith('{\n  "ok": true')).toBe(true);
    expect(JSON.parse(ordinary.stdout)).toMatchObject({ ok: true, status: 'ok', term: 'coffee' });

    const table = await runAskCli(['coffee', '--validate', '--no-anchor', '--fresh', '--pretty', '--store', store], { query });
    expect(table.code).toBe(0);
    expect(table.stdout.startsWith('term | verdict | conf | est/day')).toBe(true);
    expect(() => JSON.parse(table.stdout)).toThrow();
  });

  it('treats --pretty after the argument separator as a term, not a formatting flag', async () => {
    const store = temporaryStore();
    const query = successfulQuery();
    const result = await runAskCli(['--fresh', '--store', store, '--', '--pretty'], { query });
    expect(result.code).toBe(0);
    expect(result.stdout.startsWith('{"ok":true')).toBe(true);
    expect(result.stdout).not.toContain('\n  "ok"');
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, term: '--pretty' });
  });

  it('indents validation batches, diff output, and structured parse errors with unchanged exit codes', async () => {
    const store = temporaryStore();
    const query = successfulQuery();
    const batch = await runAskCli(['--validate', '--from', '-', '--json', '--pretty', '--no-anchor', '--fresh', '--store', store], {
      query,
      stdin: '["coffee", "tea"]',
    });
    expect(batch.code).toBe(0);
    expect(batch.stdout.startsWith('[\n  {')).toBe(true);
    expect(JSON.parse(batch.stdout)).toHaveLength(2);

    const diff = await runAskCli(['coffee', '--diff', '--pretty', '--store', store], { query });
    expect(diff.code).toBe(0);
    expect(diff.stdout.startsWith('{\n  "ok": true')).toBe(true);
    expect(JSON.parse(diff.stdout)).toHaveProperty('diff');

    const error = await runAskCli(['coffee', '--pretty', '--unknown-option']);
    expect(error.code).toBe(4);
    expect(error.stdout.startsWith('{\n  "ok": false')).toBe(true);
    expect(JSON.parse(error.stdout)).toMatchObject({ status: 'error', error: { code: 'INVALID_INPUT' } });
  });
});
