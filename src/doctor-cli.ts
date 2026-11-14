import { parseArgs } from 'node:util';
import { runDoctor, type DoctorResult } from './doctor.js';

export interface DoctorCliResult { stdout: string; stderr: string; code: number }

const help = `gtfa doctor — check this machine can reach Google Trends

Usage:
  gtfa doctor [--json] [--pretty] [--timeout MS]

  --timeout MS   Per-request timeout, 1000–60000 (default 8000)

Checks:
  node           Node.js >= 20
  reachability   Google Trends HTTP reachability through the current network/proxy
  proxy          direct, or HTTPS_PROXY/HTTP_PROXY when set
  fetch          one live gpts US 24h interest fetch

Exit codes: 0 all checks pass, 1 a check failed, 4 invalid usage
JSON output: --json prints { ok, checks[], summary, node, proxy }`;

export function formatDoctor(result: DoctorResult): string {
  const lines: string[] = [];
  for (const check of result.checks) {
    lines.push(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
    if (!check.ok && check.hint) lines.push(`  hint: ${check.hint}`);
  }
  lines.push(`Summary: ${result.summary.passed} passed, ${result.summary.failed} failed`);
  return lines.join('\n');
}

export async function runDoctorCli(argv: string[]): Promise<DoctorCliResult> {
  let values: { json?: boolean; pretty?: boolean; help?: boolean; timeout?: string };
  let timeoutMs: number | undefined;
  try {
    values = parseArgs({
      args: argv,
      options: { json: { type: 'boolean' }, pretty: { type: 'boolean' }, help: { type: 'boolean' }, timeout: { type: 'string' } },
    }).values;
    if (values.help) return { stdout: values.json ? JSON.stringify({ help }) : help, stderr: '', code: 0 };
    if (values.timeout !== undefined) {
      timeoutMs = Number(values.timeout);
      if (!/^\d+$/.test(values.timeout) || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
        throw new Error('timeout must be an integer from 1000 to 60000');
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid arguments';
    return { stdout: JSON.stringify({ ok: false, error: { code: 'INVALID_INPUT', message }, checks: [], summary: { passed: 0, failed: 0 } }), stderr: '', code: 4 };
  }
  try {
    const result = await runDoctor({ timeoutMs });
    return { stdout: values.json ? JSON.stringify(result, null, values.pretty ? 2 : undefined) : formatDoctor(result), stderr: '', code: result.ok ? 0 : 1 };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'doctor failed';
    const result = { ok: false, error: { code: 'INTERNAL_ERROR', message }, checks: [], summary: { passed: 0, failed: 0 } };
    return { stdout: values.json ? JSON.stringify(result) : `FAIL doctor: ${message}`, stderr: '', code: 1 };
  }
}
