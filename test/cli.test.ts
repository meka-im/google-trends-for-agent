import { spawnSync } from 'node:child_process';
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const tsxImport = import.meta.resolve('tsx');
const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const cliFetchPath = fileURLToPath(new URL('./cli-fetch.mjs', import.meta.url));
const args = ['--import', tsxImport, '--import', cliFetchPath, cliPath];
const env = { ...process.env, HTTPS_PROXY: '', https_proxy: '', HTTP_PROXY: '', http_proxy: '' };
const packageVersion = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

function runCli(cliArgs: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'google-trends-for-agent-cli-'));
  const out = join(dir, 'stdout');
  const err = join(dir, 'stderr');
  const stdout = openSync(out, 'w');
  const stderr = openSync(err, 'w');
  try {
    const result = spawnSync(process.execPath, [...args, ...cliArgs], {
      env: options.env ?? env,
      cwd: options.cwd,
      stdio: ['ignore', stdout, stderr],
      timeout: 20_000,
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: readFileSync(out, 'utf8'), stderr: readFileSync(err, 'utf8') };
  } finally {
    closeSync(stdout);
    closeSync(stderr);
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('CLI offline output', () => {
  it('defaults compare and --query to US / now 7-d, honors config defaults, and preserves explicit dates', () => {
    const clean = { ...env };
    delete clean.GTFA_GEO;
    delete clean.GTFA_TIME;

    const cmp = JSON.parse(runCli(['compare', 'coffee', 'tea', '--min-interval', '0'], { env: clean }).stdout);
    expect(cmp.input).toMatchObject({ geo: 'US', timeRange: 'now 7-d' });

    const single = JSON.parse(runCli(['--query', 'coffee', '--time', 'today 1-m', '--types', 'interestOverTime', '--format', 'json', '--min-interval', '0'], { env: clean }).stdout);
    expect(single.status).toBe('ok');
    expect(single.data.interestOverTime.timeline.length).toBeGreaterThan(0);

    const dated = JSON.parse(runCli(['--query', 'coffee', '--start', '2026-01-01', '--end', '2026-02-01', '--min-interval', '0'], { env: clean }).stdout);
    expect(dated.input).toMatchObject({ geo: 'US', startDate: '2026-01-01', endDate: '2026-02-01' });
    expect(dated.input.timeRange ?? null).toBeNull();

    const cwd = mkdtempSync(join(tmpdir(), 'gtfa-cli-cfg-'));
    try {
      writeFileSync(join(cwd, 'gtfa.config.json'), JSON.stringify({
        filter: { geo: 'gb', time: 'now 7-d', category: 45, property: 'news', hl: 'fr' },
      }));
      const configured = JSON.parse(runCli(['--query', 'coffee', '--format', 'json', '--min-interval', '0'], { env: clean, cwd }).stdout);
      expect(configured.input).toMatchObject({ geo: 'GB', timeRange: 'now 7-d', category: 45, searchType: 'news', locale: 'fr' });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 20000);

  it('prints CSV and rejects duplicate keywords or invalid formats without fetching', () => {
    const csv = runCli(['--query', 'coffee', '--format', 'csv', '--min-interval', '0']);
    expect(csv.status).toBe(0);
    expect(csv.stdout).toContain('"timeline"');

    const dup = runCli(['compare', 'Coffee', ' coffee ', '--json']);
    expect(dup.status).toBe(4);
    expect(JSON.parse(dup.stdout)).toMatchObject({ status: 'error', error: { code: 'INVALID_INPUT', message: expect.stringContaining('duplicate keyword: "coffee"') }, meta: { upstreamRequests: 0 } });

    const badFormat = runCli(['--query', 'coffee', '--format', 'invalid']);
    expect(badFormat.status).toBe(4);
    expect(JSON.parse(badFormat.stdout)).toMatchObject({ status: 'error', meta: { upstreamRequests: 0 }, error: { code: 'INVALID_INPUT' } });

    const badCsv = runCli(['--query', 'x', '--types', 'bogus', '--format', 'csv']);
    expect(badCsv.status).toBe(4);
    expect(badCsv.stdout).toContain('INVALID_INPUT');
  });
});

describe('CLI flags, doctor, and exit codes', () => {
  it('runs doctor offline and prints JSON help and version', () => {
    const doctor = JSON.parse(runCli(['doctor', '--json']).stdout);
    expect(doctor).toMatchObject({ ok: true, summary: { passed: 4, failed: 0 }, proxy: { direct: true } });
    expect(doctor.checks.map((c: { name: string }) => c.name)).toEqual(['node', 'reachability', 'proxy', 'fetch']);

    const help = JSON.parse(runCli(['--help']).stdout).help as string;
    expect(help).toContain('gtfa ask <term>');
    expect(help).toContain('now --geo');
    expect(help).toContain('--from FILE|-');
    expect(help).toContain('Exit codes:');

    expect(JSON.parse(runCli(['--version']).stdout)).toEqual({ name: 'google-trends-for-agent', version: packageVersion });
  }, 20000);

  it('rejects unknown/invalid flags with schema envelope and maps upstream failures to exit codes', () => {
    const unknown = runCli(['--unknown', '--json']);
    expect(unknown.status).toBe(4);
    expect(JSON.parse(unknown.stdout)).toMatchObject({ ok: false, schemaVersion: 1, status: 'error', error: { code: 'INVALID_INPUT' } });
    expect(unknown.stderr).toContain('INVALID_INPUT');

    const badTimeout = runCli(['--query', 'x', '--timeout', 'bogus']);
    expect(badTimeout.status).toBe(4);
    expect(JSON.parse(badTimeout.stdout).error.code).toBe('INVALID_INPUT');

    for (const [failure, code, error] of [['blocked', 3, 'BLOCKED'], ['rate', 3, 'RATE_LIMITED'], ['server', 1, 'TRENDS_TEMPORARILY_UNAVAILABLE']] as const) {
      const result = runCli(['--query', 'x', '--retries', '0', '--min-interval', '0', '--pretty'], { env: { ...env, TRENDS_TEST_FAILURE: failure } });
      expect(result.status).toBe(code);
      expect(JSON.parse(result.stdout).error.code).toBe(error);
      expect(result.stderr).toContain(error);
    }
  }, 20000);
});
