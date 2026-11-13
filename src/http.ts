import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GTrendsError } from './core.js';
import type { GtfaTool } from './tools.js';
import { isAbortError, type Transport } from './transport.js';
import { runWithRequestSignal } from './request-context.js';
import { VERSION } from './version.js';

export const DEFAULT_HTTP_PORT = 4321;
export const DEFAULT_MCP_PATH = '/mcp';
/**
 * Standby runs carry APIFY_META_ORIGIN=STANDBY. ACTOR_STANDBY_PORT is injected
 * into every run of a Standby-enabled Actor, so it must not decide the mode.
 */
export function isStandbyRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.APIFY_META_ORIGIN === 'STANDBY';
}

export const EGRESS_FETCH_PATH = '/egress/fetch';
export const HEALTH_PATH = '/health';
/** Relay protocol version reported by GET /health and required by the dsh plugin. */
export const RELAY_PROTOCOL_VERSION = 1;
/** Overall deadline for one tool call; the HTTP layer aborts the tool signal at this point. */
export const TOOL_DEADLINE_MS = 300_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Parse a port string/number; throws a user-facing error when invalid. */
export function parsePort(value: string | number | undefined, fallback = DEFAULT_HTTP_PORT): number {
  if (value === undefined || value === '') return fallback;
  const port = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port "${value}"; use an integer from 0 to 65535.`);
  return port;
}

/** ACTOR_STANDBY_PORT wins, then ACTOR_WEB_SERVER_PORT, then 4321. */
export function resolveStandbyPort(env: NodeJS.ProcessEnv = process.env): number {
  return parsePort(env.ACTOR_STANDBY_PORT?.trim() || env.ACTOR_WEB_SERVER_PORT?.trim() || undefined);
}

export interface IdleExitOptions {
  enabled: boolean;
  timeoutMs: number;
  /** Clean shutdown callback; injected in tests. */
  exit: () => void | Promise<void>;
  log?: (message: string) => void;
  /** Clock and scheduler seams for timer tests. */
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/**
 * Exits a Standby run after a period with no in-flight requests. This is
 * independent of the console idle timeout so the Free plan stops paying for
 * compute as soon as the short gtfa idle window passes.
 */
export class IdleExitController {
  private inFlight = 0;
  private lastActivity: number;
  private handle: unknown;
  private done = false;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(private readonly options: IdleExitOptions) {
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.lastActivity = this.now();
  }

  start(): void {
    this.tick();
  }

  enter(): void {
    this.inFlight += 1;
    this.lastActivity = this.now();
    this.clear();
  }

  leave(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.lastActivity = this.now();
    this.tick();
  }

  stop(): void {
    this.done = true;
    this.clear();
  }

  private clear(): void {
    if (this.handle !== undefined) {
      this.cancel(this.handle);
      this.handle = undefined;
    }
  }

  private tick(): void {
    if (this.done || !this.options.enabled) return;
    this.clear();
    const remaining = Math.max(0, this.options.timeoutMs - (this.now() - this.lastActivity));
    this.handle = this.schedule(() => this.check(), remaining);
  }

  private check(): void {
    if (this.done) return;
    this.handle = undefined;
    if (this.inFlight > 0) {
      this.tick();
      return;
    }
    const remaining = this.options.timeoutMs - (this.now() - this.lastActivity);
    if (remaining > 0) {
      this.tick();
      return;
    }
    this.done = true;
    this.options.log?.(`No requests for ${Math.round(this.options.timeoutMs / 1000)} s; exiting the Standby Actor to save cost.`);
    void Promise.resolve(this.options.exit()).catch(() => {});
  }
}

export interface HttpMcpServerOptions {
  /** A fresh MCP server is created for each Streamable HTTP session. */
  createMcpServer: () => McpServer;
  port?: number;
  host?: string;
  /** Defaults to /mcp. */
  path?: string;
  /** Shared tool definitions served by POST /tools/{name}. */
  tools?: GtfaTool[];
  /** Transport used by POST /egress/fetch. */
  transport?: Transport;
  /** Reported by GET /health; defaults to the package version. */
  version?: string;
  /** local validates loopback Host/Origin and enables DNS-rebinding protection; standby trusts Apify's proxy/auth. */
  mode?: 'local' | 'standby';
  /** Tool-call deadline (default 300 s); tests may shorten it. */
  deadlineMs?: number;
  /** Optional self idle-exit for Standby runs. */
  idleExit?: IdleExitOptions;
  /** Optional logging hook (never logs request bodies, query strings, or credentials). */
  log?: (message: string) => void;
}

export interface HttpMcpServer {
  server: Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

interface SessionEntry {
  mcp: McpServer;
  transport: StreamableHTTPServerTransport;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function writeText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function writeJsonRpcError(res: ServerResponse, status: number, message: string, code = -32600): void {
  writeJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });
}

function writeApiError(res: ServerResponse, status: number, code: string, message: string): void {
  writeJson(res, status, { error: { code, message } });
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function loopbackHostname(value: string | undefined): boolean {
  if (!value) return false;
  const host = value.trim().toLowerCase();
  return /^\[::1\](?::\d{1,5})?$/.test(host) || /^(localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(host);
}

function loopbackOrigin(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname.toLowerCase().replace(/^\[|\]$/g, ''));
  } catch { return false; }
}

/** Abort a tool call when the response closes early or the overall deadline expires. */
async function withAbortSignal<T>(res: ServerResponse, deadlineMs: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('tool deadline exceeded')), deadlineMs);
  let finished = false;
  const onClose = () => { if (!finished) controller.abort(new Error('client disconnected')); };
  res.once('close', onClose);
  try { return await fn(controller.signal); }
  finally {
    finished = true;
    clearTimeout(timer);
    res.off('close', onClose);
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(buffer);
  }
  if (!size) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON request body'); }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Only Google Trends over HTTPS is a valid relay target. */
function allowedRelayUrl(raw: unknown): URL | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  let url: URL;
  try { url = new URL(raw); } catch { return undefined; }
  if (url.origin !== 'https://trends.google.com' || url.username || url.password) return undefined;
  return url;
}

/** Headers the relay forwards; anything else (Host, proxy auth, hop-by-hop) is dropped. */
const RELAY_HEADERS = new Set(['accept', 'accept-language', 'content-type', 'cookie', 'referer', 'user-agent']);

function relayError(res: ServerResponse): void {
  writeApiError(res, 400, 'INVALID_INPUT', 'url must be an https://trends.google.com URL.');
}

/**
 * Starts a Streamable HTTP MCP server plus the plain endpoints used by the dsh
 * plugin. GET / is the Apify Standby readiness probe (always 200), GET /health
 * is cheap, POST /egress/fetch relays one Google Trends request, and
 * POST /tools/{name} runs a shared tool definition. POST/GET/DELETE /mcp speak
 * MCP, with one server and transport per session id.
 */
export async function startHttpMcpServer(options: HttpMcpServerOptions): Promise<HttpMcpServer> {
  const path = options.path ?? DEFAULT_MCP_PATH;
  const normalizedPath = (path.startsWith('/') ? path : `/${path}`).replace(/\/+$/, '') || '/mcp';
  const sessions = new Map<string, SessionEntry>();
  const idle = options.idleExit ? new IdleExitController(options.idleExit) : undefined;
  const local = (options.mode ?? (isStandbyRun() ? 'standby' : 'local')) === 'local';
  const deadlineMs = options.deadlineMs ?? TOOL_DEADLINE_MS;
  let closing = false;
  let boundPort = options.port ?? DEFAULT_HTTP_PORT;

  const createSession = async (): Promise<SessionEntry> => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      ...(local ? {
        enableDnsRebindingProtection: true,
        allowedHosts: ['localhost', '127.0.0.1', '[::1]', '::1',
          `localhost:${boundPort}`, `127.0.0.1:${boundPort}`, `[::1]:${boundPort}`],
      } : {}),
    });
    const mcp = options.createMcpServer();
    const entry: SessionEntry = { mcp, transport };
    let closed = false;
    transport.onclose = () => {
      if (closed) return;
      closed = true;
      const id = transport.sessionId;
      if (id) sessions.delete(id);
      void mcp.close().catch(() => {});
    };
    transport.onerror = error => options.log?.(`MCP transport error: ${error.message}`);
    await mcp.connect(transport);
    return entry;
  };

  const handleRelay = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!options.transport) {
      writeApiError(res, 503, 'NETWORK_ERROR', 'The relay transport is unavailable.');
      return;
    }
    let body: unknown;
    try { body = await readJsonBody(req); }
    catch (error) {
      writeApiError(res, 400, 'INVALID_INPUT', error instanceof Error ? error.message : 'Invalid request body');
      return;
    }
    const row = record(body);
    const url = allowedRelayUrl(row.url);
    if (!url) { relayError(res); return; }
    const method = typeof row.method === 'string' && row.method.trim() ? row.method.trim().toUpperCase() : 'GET';
    if (!/^[A-Z]{1,16}$/.test(method)) {
      writeApiError(res, 400, 'INVALID_INPUT', 'method must be an HTTP method name.');
      return;
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(record(row.headers))) {
      if (typeof value === 'string' && RELAY_HEADERS.has(key.toLowerCase())) headers[key] = value;
    }
    if (row.body !== undefined && typeof row.body !== 'string') {
      writeApiError(res, 400, 'INVALID_INPUT', 'body must be a string.');
      return;
    }
    const requestBody = row.body as string | undefined;
    if (requestBody !== undefined && Buffer.byteLength(requestBody) > MAX_BODY_BYTES) {
      writeApiError(res, 400, 'INVALID_INPUT', 'body is too large.');
      return;
    }
    const rawTimeout = typeof row.timeoutMs === 'number' && Number.isFinite(row.timeoutMs) ? row.timeoutMs : DEFAULT_TIMEOUT_MS;
    const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1000, Math.round(rawTimeout)));
    options.log?.(`Relay ${method} ${url.pathname}`);
    const relayed = { url: url.toString(), method, headers, ...(requestBody === undefined ? {} : { body: requestBody }), timeoutMs };
    // One retry: the proxy transport rotates its session after a failed connection.
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await options.transport(relayed);
        writeJson(res, 200, { status: response.status, headers: response.headers, body: response.body });
        return;
      } catch (error) {
        const code = error instanceof GTrendsError ? error.code : error instanceof Error ? error.name : 'Error';
        options.log?.(`Relay ${method} ${url.pathname} failed (attempt ${attempt}, ${code})`);
        if (attempt >= 2) break;
      }
    }
    writeApiError(res, 502, 'NETWORK_ERROR', 'The Actor could not complete the request. Retry in a moment.');
  };

  const handleTool = async (req: IncomingMessage, res: ServerResponse, name: string): Promise<void> => {
    const tool = options.tools?.find(candidate => candidate.name === name);
    if (!tool) {
      writeApiError(res, 404, 'INVALID_INPUT', `Unknown tool "${name}".`);
      return;
    }
    let body: unknown;
    try { body = await readJsonBody(req); }
    catch (error) {
      writeApiError(res, 400, 'INVALID_INPUT', error instanceof Error ? error.message : 'Invalid request body');
      return;
    }
    options.log?.(`Tool ${name}`);
    try {
      const result = await withAbortSignal(res, deadlineMs, signal => tool.execute(record(body), { signal }));
      const row = record(result);
      const error = record(row.error);
      if (row.ok === false && typeof error.code === 'string' && typeof error.message === 'string') {
        writeJson(res, 200, {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            ...(typeof error.retryAfterSec === 'number' ? { retryAfterSec: error.retryAfterSec } : {}),
          },
        });
        return;
      }
      writeJson(res, 200, { ok: true, result });
    } catch (error) {
      if (isAbortError(error) && res.destroyed) return;
      if (isAbortError(error)) {
        writeApiError(res, 504, 'TRENDS_TIMEOUT', `The tool call exceeded the ${Math.round(deadlineMs / 1000)} s deadline.`);
      } else if (error instanceof GTrendsError) writeJson(res, 200, { ok: false, error: { code: error.code, message: error.message } });
      else writeApiError(res, 500, 'INTERNAL', 'The tool call failed.');
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (local) {
      const host = header(req, 'host');
      if (!loopbackHostname(host)) {
        writeApiError(res, 403, 'FORBIDDEN', 'Host header must be localhost, 127.0.0.1, or [::1].');
        return;
      }
      const origin = header(req, 'origin');
      if (origin !== undefined && !loopbackOrigin(origin)) {
        writeApiError(res, 403, 'FORBIDDEN', 'Origin must be a loopback origin.');
        return;
      }
      // The SDK allowlist compares exact Host values; normalize an already-validated
      // loopback Host so any server port is accepted.
      req.headers.host = `127.0.0.1:${boundPort}`;
    }
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    if (pathname === '/' || pathname === HEALTH_PATH) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        writeText(res, 405, 'Method not allowed\n');
        return;
      }
      if (pathname === HEALTH_PATH) {
        const build = process.env.ACTOR_BUILD_NUMBER?.trim();
        writeJson(res, 200, { ok: true, version: options.version ?? VERSION, relay: RELAY_PROTOCOL_VERSION, ...(build ? { build } : {}) });
        return;
      }
      const probe = header(req, 'x-apify-container-server-readiness-probe');
      writeText(res, 200, probe ? 'Readiness probe OK\n' : 'google-trends-for-agent MCP is ready\n');
      return;
    }

    if (pathname === EGRESS_FETCH_PATH) {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        writeText(res, 405, 'Method not allowed\n');
        return;
      }
      await handleRelay(req, res);
      return;
    }

    if (pathname.startsWith('/tools/')) {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        writeText(res, 405, 'Method not allowed\n');
        return;
      }
      let name: string;
      try { name = decodeURIComponent(pathname.slice('/tools/'.length)); }
      catch {
        writeApiError(res, 400, 'INVALID_INPUT', 'Invalid tool name.');
        return;
      }
      await handleTool(req, res, name);
      return;
    }

    if (pathname !== normalizedPath) {
      writeText(res, 404, 'Not found\n');
      return;
    }

    const sessionId = header(req, 'mcp-session-id');

    if (req.method === 'GET' || req.method === 'DELETE') {
      if (!sessionId) {
        writeJsonRpcError(res, 400, 'Missing Mcp-Session-Id header; initialize the MCP session first.');
        return;
      }
      const entry = sessions.get(sessionId);
      if (!entry) {
        writeJsonRpcError(res, 404, 'Unknown MCP session; initialize again.', -32001);
        return;
      }
      if (req.method === 'DELETE') {
        sessions.delete(sessionId);
        await entry.transport.close();
        await entry.mcp.close().catch(() => {});
        writeJson(res, 200, { ok: true });
        return;
      }
      await entry.transport.handleRequest(req, res);
      return;
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST, DELETE, OPTIONS');
      writeText(res, 405, 'Method not allowed\n');
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      writeJsonRpcError(res, 400, error instanceof Error ? error.message : 'Invalid request body', -32700);
      return;
    }

    let entry = sessionId ? sessions.get(sessionId) : undefined;
    if (sessionId && !entry) {
      writeJsonRpcError(res, 404, 'Unknown MCP session; initialize again.', -32001);
      return;
    }
    if (!entry) {
      entry = await createSession();
    }

    await withAbortSignal(res, deadlineMs, signal => runWithRequestSignal(signal, () => entry!.transport.handleRequest(req, res, body)));
    const assigned = entry.transport.sessionId;
    if (assigned) {
      if (!sessions.has(assigned)) sessions.set(assigned, entry);
    } else {
      // A rejected non-initialize request never becomes a session; close it.
      await entry.transport.close().catch(() => {});
      await entry.mcp.close().catch(() => {});
    }
  };

  const server = createHttpServer((req, res) => {
    // Readiness probes are not activity; everything else counts until both the
    // handler has finished and the response has closed.
    const tracked = idle && !header(req, 'x-apify-container-server-readiness-probe');
    let pending = tracked ? 2 : 0;
    const release = () => { if (pending > 0 && --pending === 0) idle?.leave(); };
    if (tracked) {
      idle.enter();
      res.once('close', release);
    }
    handle(req, res).catch(error => {
      options.log?.(`HTTP request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) writeJsonRpcError(res, 500, 'Internal server error', -32603);
      else res.end();
    }).finally(release);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? DEFAULT_HTTP_PORT, options.host ?? '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  const port = address?.port ?? options.port ?? DEFAULT_HTTP_PORT;
  boundPort = port;
  const host = options.host ?? '127.0.0.1';
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${port}${normalizedPath}`;
  options.log?.(`MCP Streamable HTTP listening on ${url}`);
  idle?.start();

  return {
    server,
    port,
    url,
    close: async () => {
      if (closing) return;
      closing = true;
      idle?.stop();
      for (const entry of sessions.values()) {
        await entry.transport.close().catch(() => {});
        await entry.mcp.close().catch(() => {});
      }
      sessions.clear();
      await new Promise<void>(resolve => {
        server.close(() => resolve());
        server.closeIdleConnections();
        server.closeAllConnections?.();
      });
    },
  };
}
