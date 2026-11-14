import { queryTrends, type TrendsResponse } from './api.js';
import { GTrendsError } from './core.js';
import {
  createDefaultTransport, getProxyConfig, isChallengeResponse, isRateLimitResponse, redactProxyUrl, type Transport,
} from './transport.js';

export const REQUIRED_NODE_MAJOR = 20;
export const DOCTOR_TIMEOUT_MS = 8000;

export type DoctorCheckName = 'node' | 'reachability' | 'proxy' | 'fetch';
export interface DoctorCheck { name: DoctorCheckName; ok: boolean; detail: string; hint?: string }
export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
  summary: { passed: number; failed: number };
  node: { version: string; required: string };
  proxy: { source: string; url: string | null; direct: boolean };
}
export interface DoctorOptions {
  env?: NodeJS.ProcessEnv;
  nodeVersion?: string;
  transport?: Transport;
  query?: (input: Record<string, unknown>) => Promise<TrendsResponse>;
  timeoutMs?: number;
}

const hintFor = (code?: string): string => {
  if (code === 'BLOCKED') return 'Stop and report. Retry later, reduce request rate, or set HTTPS_PROXY/HTTP_PROXY to use a different egress.';
  if (code === 'RATE_LIMITED') return 'Wait for retryAfterSec, then retry once. Lower request rate or set HTTPS_PROXY/HTTP_PROXY.';
  if (code === 'TRENDS_TIMEOUT' || code === 'NETWORK_ERROR') return 'Check network, DNS, firewall, and proxy settings. Set HTTPS_PROXY or HTTP_PROXY if this machine needs a proxy.';
  if (code === 'TRENDS_TEMPORARILY_UNAVAILABLE') return 'Retry in a moment. If it persists, check your connection or proxy.';
  if (code === 'TRENDS_PROTOCOL_CHANGED') return 'Retry later; if it persists, update to the latest main branch of google-trends-for-agent.';
  return 'Retry once. If it persists, check network/proxy settings and report the error code.';
};

const failureDetail = (error: unknown): string => error instanceof GTrendsError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
type StopFetchCode = 'BLOCKED' | 'RATE_LIMITED';
interface ReachabilityResult {
  check: DoctorCheck;
  stopFetchCode?: StopFetchCode;
}

function nodeCheck(version: string): DoctorCheck {
  const major = Number(/^v?(\d+)/.exec(version)?.[1] ?? 0);
  const ok = major >= REQUIRED_NODE_MAJOR;
  const display = version.startsWith('v') ? version : `v${version}`;
  return { name: 'node', ok, detail: `Node ${display} (requires >=${REQUIRED_NODE_MAJOR})`, ...(ok ? {} : { hint: `Install Node.js ${REQUIRED_NODE_MAJOR} or newer from https://nodejs.org.` }) };
}

function proxyCheck(env: NodeJS.ProcessEnv): { check: DoctorCheck; proxy: DoctorResult['proxy']; valid: boolean } {
  const proxy = getProxyConfig(env);
  if (!proxy.url) return { check: { name: 'proxy', ok: true, detail: 'direct (no HTTPS_PROXY/HTTP_PROXY set)' }, proxy: { source: proxy.source, url: null, direct: true }, valid: true };
  const redacted = redactProxyUrl(proxy.url);
  try {
    const parsed = new URL(proxy.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('URL must start with http:// or https://');
    return { check: { name: 'proxy', ok: true, detail: `${proxy.source}=${redacted}` }, proxy: { source: proxy.source, url: redacted, direct: false }, valid: true };
  } catch (error) {
    return {
      check: { name: 'proxy', ok: false, detail: `${proxy.source}=${redacted} is invalid: ${error instanceof Error ? error.message : 'invalid URL'}`, hint: 'Set it to http://host:port (or https://host:port), or unset it for a direct connection.' },
      proxy: { source: proxy.source, url: redacted, direct: false }, valid: false,
    };
  }
}

async function reachabilityCheck(transport: Transport | undefined, transportError: unknown, timeoutMs: number): Promise<ReachabilityResult> {
  if (!transport) return {
    check: { name: 'reachability', ok: false, detail: `could not create transport: ${failureDetail(transportError)}`, hint: hintFor('NETWORK_ERROR') },
  };
  const started = Date.now();
  try {
    const res = await transport({ url: 'https://trends.google.com/trends/', method: 'HEAD', headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html' }, timeoutMs });
    const ms = Date.now() - started;
    if (isRateLimitResponse(res)) return {
      check: { name: 'reachability', ok: false, detail: `Google Trends responded HTTP 429 in ${ms} ms (rate limited)`, hint: hintFor('RATE_LIMITED') },
      stopFetchCode: 'RATE_LIMITED',
    };
    if (isChallengeResponse(res)) return {
      check: { name: 'reachability', ok: false, detail: `Google Trends returned a challenge page in ${ms} ms`, hint: hintFor('BLOCKED') },
      stopFetchCode: 'BLOCKED',
    };
    if (res.status >= 400) return {
      check: { name: 'reachability', ok: false, detail: `Google Trends responded HTTP ${res.status} in ${ms} ms`, hint: hintFor(res.status >= 500 ? 'TRENDS_TEMPORARILY_UNAVAILABLE' : 'TRENDS_PROTOCOL_CHANGED') },
    };
    return { check: { name: 'reachability', ok: true, detail: `Google Trends responded HTTP ${res.status} in ${ms} ms` } };
  } catch (error) {
    const code = error instanceof GTrendsError ? error.code : undefined;
    return {
      check: { name: 'reachability', ok: false, detail: `could not reach Google Trends: ${failureDetail(error)}`, hint: hintFor(code ?? 'NETWORK_ERROR') },
      ...(code === 'BLOCKED' || code === 'RATE_LIMITED' ? { stopFetchCode: code } : {}),
    };
  }
}

async function fetchCheck(query: ((input: Record<string, unknown>) => Promise<TrendsResponse>) | undefined, timeoutMs: number, skipped?: string): Promise<DoctorCheck> {
  if (!query) return { name: 'fetch', ok: false, detail: skipped ?? 'skipped because no transport is available', hint: hintFor('NETWORK_ERROR') };
  try {
    const result = await query({ queries: ['gpts'], geo: 'US', timeRange: 'now 1-d', dataTypes: ['interestOverTime'], maxRetries: 1, timeoutMs });
    const timeline = (result.data?.interestOverTime as { timeline?: unknown[] } | undefined)?.timeline;
    const points = Array.isArray(timeline) ? timeline.length : 0;
    if (result.status === 'ok' && points > 0) return { name: 'fetch', ok: true, detail: `gpts US 24h fetch returned ${points} interest points (${result.meta.upstreamRequests} upstream requests)` };
    const code = result.error?.code;
    return { name: 'fetch', ok: false, detail: code ? `gpts US 24h fetch failed: ${code}: ${result.error!.message}` : `gpts US 24h fetch returned ${result.status} with ${points} interest points`, hint: hintFor(code) };
  } catch (error) {
    return { name: 'fetch', ok: false, detail: `gpts US 24h fetch failed: ${failureDetail(error)}`, hint: hintFor(error instanceof GTrendsError ? error.code : undefined) };
  }
}

/** Run all diagnostics in a fixed order; never throws for expected network or config failures. */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const env = options.env ?? process.env;
  const nodeVersion = options.nodeVersion ?? process.version;
  const timeoutMs = options.timeoutMs ?? DOCTOR_TIMEOUT_MS;
  const proxy = proxyCheck(env);
  let transport = options.transport;
  let transportError: unknown;
  if (!transport) {
    try { transport = createDefaultTransport(env); }
    catch (error) { transportError = error; }
  }
  const reachability = await reachabilityCheck(transport, transportError, timeoutMs);
  const checks: DoctorCheck[] = [nodeCheck(nodeVersion), reachability.check, proxy.check];
  const query = options.query ?? (transport && proxy.valid ? (input: Record<string, unknown>) => queryTrends(input, { transport }) : undefined);
  checks.push(reachability.stopFetchCode
    ? { name: 'fetch', ok: false, detail: `skipped after upstream ${reachability.stopFetchCode}`, hint: hintFor(reachability.stopFetchCode) }
    : await fetchCheck(query, timeoutMs, !proxy.valid ? 'skipped because the proxy configuration is invalid' : !transport ? 'skipped because no transport is available' : undefined));
  const failed = checks.filter(c => !c.ok).length;
  return {
    ok: failed === 0,
    checks,
    summary: { passed: checks.length - failed, failed },
    node: { version: nodeVersion, required: `>=${REQUIRED_NODE_MAJOR}` },
    proxy: proxy.proxy,
  };
}
