import { spawnSync } from 'node:child_process';
import { mkdtempSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
const args = ['--import', 'tsx', '--import', './test/cli-fetch.mjs', 'src/cli.ts'];
const env = { ...process.env, HTTPS_PROXY: '', https_proxy: '' };
// Capture through files so subprocess tests also work where pipe polling is restricted.
function runCli(cliArgs: string[], options: { encoding: string; env: NodeJS.ProcessEnv }): { status: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'google-trends-for-agent-cli-'));
  const out = join(dir, 'stdout');
  const err = join(dir, 'stderr');
  const stdout = openSync(out, 'w');
  const stderr = openSync(err, 'w');
  try {
    const result = spawnSync(process.execPath, cliArgs, { env: options.env, stdio: ['ignore', stdout, stderr] });
    if (result.error) throw result.error;
    return { status: result.status, stdout: readFileSync(out, 'utf8'), stderr: readFileSync(err, 'utf8') };
  } finally {
    closeSync(stdout);
    closeSync(stderr);
    rmSync(dir, { recursive: true, force: true });
  }
}
describe('CLI offline output', () => {
  it('compare and default --query use US / now 1-d like MCP, but keep explicit dates', () => {
    const clean = { ...env, GTFA_GEO: '', GTFA_TIME: '' }; delete (clean as Record<string, unknown>).GTFA_GEO; delete (clean as Record<string, unknown>).GTFA_TIME;
    for (const cli of [['compare', 'coffee', 'tea'], ['--query', 'coffee']]) {
      const r = JSON.parse(runCli([...args, ...cli], { encoding: 'utf8', env: clean }).stdout);
      expect(r.input).toMatchObject({ geo: 'US', timeRange: 'now 1-d' });
    }
    const dated = JSON.parse(runCli([...args, '--query', 'coffee', '--start', '2026-01-01', '--end', '2026-02-01'], { encoding: 'utf8', env: clean }).stdout);
    expect(dated.input).toMatchObject({ geo: 'US', startDate: '2026-01-01', endDate: '2026-02-01' });
    expect(dated.input.timeRange ?? null).toBeNull();
  }, 20000);
  it('prints the required JSON envelope for a fixture query', () => {
    const { stdout: output } = runCli([...args, '--query', 'coffee', '--time', 'today 1-m', '--types', 'interestOverTime', '--format', 'json'], { encoding: 'utf8', env });
    const result = JSON.parse(output);
    expect(result.status).toBe('ok');
    expect(result.meta).toMatchObject({ upstreamRequests: 3, warnings: [] });
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(1900);
    expect(result.data.interestOverTime.timeline.length).toBeGreaterThan(0);
  });
  it('prints CSV and returns structured errors without fetching invalid input', () => {
    const { stdout: output } = runCli([...args, '--query', 'coffee', '--format', 'csv'], { encoding: 'utf8', env });
    expect(output).toContain('"timeline"');
    const invalid = runCli([...args, '--query', 'coffee', '--format', 'invalid'], { encoding: 'utf8', env });
    expect(invalid.status).toBe(4);
    expect(JSON.parse(invalid.stdout)).toMatchObject({ status: 'error', meta: { upstreamRequests: 0 }, error: { code: 'INVALID_INPUT' } });
  });
});

describe('CLI flags and exit codes', () => {
  it('runs doctor with pass lines and JSON offline', () => {
    const text = runCli([...args, 'doctor'], { encoding: 'utf8', env });
    expect(text.status).toBe(0);
    expect(text.stdout).toMatch(/PASS node:/);
    expect(text.stdout).toMatch(/PASS fetch: gpts US 24h fetch returned \d+ interest points/);
    expect(text.stdout).toContain('Summary: 4 passed, 0 failed');
    const json = JSON.parse(runCli([...args, 'doctor', '--json'], { encoding: 'utf8', env }).stdout);
    expect(json).toMatchObject({ ok: true, summary: { passed: 4, failed: 0 }, proxy: { direct: true } });
    expect(json.checks.map((c: { name: string }) => c.name)).toEqual(['node', 'reachability', 'proxy', 'fetch']);
  }, 20000);
  it('returns doctor help and rejects unknown flags', () => {
    expect(runCli([...args, 'doctor', '--help'], { encoding: 'utf8', env }).stdout).toContain('gtfa doctor');
    expect(runCli([...args, 'help', 'doctor'], { encoding: 'utf8', env }).stdout).toContain('gtfa doctor');
    const bad = runCli([...args, 'doctor', '--bogus'], { encoding: 'utf8', env });
    expect(bad.status).toBe(4);
    expect(JSON.parse(bad.stdout).error.code).toBe('INVALID_INPUT');
  });
  it('supports help and version offline', () => {
    expect((runCli([...args, '--help'], { encoding: 'utf8', env })).stdout).toContain('gtfa ask <term>');
    expect(JSON.parse(runCli([...args, '--version'], { encoding: 'utf8', env }).stdout)).toEqual({ name: 'google-trends-for-agent', version: '0.1.0' });
  });
  it.each(['--unknown', '--types', '--timeout', '--retries', '--min-interval'])('rejects invalid %s offline', flag => {
    const invalid = runCli([...args, '--query', 'x', flag, 'bogus'], { encoding: 'utf8', env });
    expect(invalid.status).toBe(4);
    expect(JSON.parse(invalid.stdout).error.code).toBe('INVALID_INPUT');
  });
  it.each([['blocked', 3, 'BLOCKED'], ['rate', 3, 'RATE_LIMITED'], ['server', 1, 'TRENDS_TEMPORARILY_UNAVAILABLE']])('maps %s failures to exit codes', (failure, code, error) => {
    const result = runCli([...args, '--query', 'x', '--retries', '0', '--min-interval', '0', '--pretty'], { encoding: 'utf8', env: { ...env, TRENDS_TEST_FAILURE: String(failure) } });
    expect(result.status).toBe(code);
    expect(JSON.parse(result.stdout).error.code).toBe(error);
    expect(result.stderr).toContain(error);
  });
  it('exports CSV on validation failure', () => {
    const result = runCli([...args, '--query', 'x', '--types', 'bogus', '--format', 'csv'], { encoding: 'utf8', env });
    expect(result.status).toBe(4);
    expect(result.stdout).toContain('INVALID_INPUT');
  });
});

 describe('CLI help modes', () => {
  it.each([['--help'], ['help'], ['help', 'now'], ['now', '--help']])('returns JSON help for %j', (...flags) => {
    const r = runCli([...args, ...flags], { encoding: 'utf8', env });
    expect(r.status).toBe(0);
    const { help } = JSON.parse(r.stdout);
    expect(help).toContain('now --geo');
    expect(help).toContain('Exit codes:');
    expect(help).toMatch(/Example/);
  });
  it.each([['--unknown'], ['now', '--unknown'], ['now', '--format', 'csv', '--unknown']])('returns JSON for unknown flags %j', (...flags) => {
    const r = runCli([...args, ...flags], { encoding: 'utf8', env });
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout)).toMatchObject({ status: 'error', error: { code: 'INVALID_INPUT' } });
  });
});
