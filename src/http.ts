import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const DEFAULT_HTTP_PORT = 4321;
export const DEFAULT_MCP_PATH = '/mcp';

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

export interface HttpMcpServerOptions {
  /** A fresh MCP server is created for each Streamable HTTP session. */
  createMcpServer: () => McpServer;
  port?: number;
  host?: string;
  /** Defaults to /mcp. */
  path?: string;
  /** Optional logging hook (never logs request bodies or credentials). */
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

function writeJsonRpcError(res: ServerResponse, status: number, message: string, code = -32600): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version');
  res.setHeader('Access-Control-Max-Age', '86400');
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

/**
 * Starts a Streamable HTTP MCP server. GET / is the Apify Standby readiness
 * probe (always 200) and POST/GET/DELETE /mcp speak MCP. One MCP server and
 * transport are kept per session id.
 */
export async function startHttpMcpServer(options: HttpMcpServerOptions): Promise<HttpMcpServer> {
  const path = options.path ?? DEFAULT_MCP_PATH;
  const normalizedPath = (path.startsWith('/') ? path : `/${path}`).replace(/\/+$/, '') || '/mcp';
  const sessions = new Map<string, SessionEntry>();
  let closing = false;

  const createSession = async (): Promise<SessionEntry> => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
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

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    setCors(res);
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '') || '/';

    if (pathname === '/' || pathname === '/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        writeText(res, 405, 'Method not allowed\n');
        return;
      }
      const probe = header(req, 'x-apify-container-server-readiness-probe');
      writeText(res, 200, probe ? 'Readiness probe OK\n' : 'google-trends-for-agent MCP is ready\n');
      return;
    }

    if (pathname !== normalizedPath) {
      writeText(res, 404, 'Not found\n');
      return;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
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
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
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

    await entry.transport.handleRequest(req, res, body);
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
    handle(req, res).catch(error => {
      options.log?.(`HTTP request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) writeJsonRpcError(res, 500, 'Internal server error', -32603);
      else res.end();
    });
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
  const host = options.host ?? '127.0.0.1';
  const url = `http://${host.includes(':') ? `[${host}]` : host}:${port}${normalizedPath}`;
  options.log?.(`MCP Streamable HTTP listening on ${url}`);

  return {
    server,
    port,
    url,
    close: async () => {
      if (closing) return;
      closing = true;
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
