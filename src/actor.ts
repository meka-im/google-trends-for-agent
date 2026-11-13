import { readFileSync } from 'node:fs';
import { Actor } from 'apify';
import { createServer } from './mcp.js';
import { startHttpMcpServer, resolveStandbyPort, type HttpMcpServer } from './http.js';
import { ApifyProxySession, actorProxyInput, createRotatingTransport } from './actor-proxy.js';
import { createDefaultTransport, type Transport } from './transport.js';
import { createTools, type GtfaTool } from './tools.js';
import { loadBaselinesFromEnv } from './traffic.js';
import { runOnce, validateActorRunInput, type ActorRunInput } from './actor-run.js';

interface ActorInput extends ActorRunInput {
  proxyConfiguration?: Record<string, unknown>;
  anchor?: string;
  geo?: string;
}

const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const version = (() => {
  try { return String((JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }).version ?? '0.1.0'); }
  catch { return '0.1.0'; }
})();

/** Standby is signalled by the platform origin or by the port it injects. */
const standby = process.env.APIFY_META_ORIGIN === 'STANDBY' || Boolean(process.env.ACTOR_STANDBY_PORT?.trim());

await Actor.init();

try {
  const input = (await Actor.getInput<ActorInput>()) ?? {};
  if (!standby && validateActorRunInput(input)) {
    // Fail fast without building a proxy or tools for an input we cannot run.
    const result = await runOnce(input, {
      pushData: item => Actor.pushData(item),
      setValue: (key, value, options) => Actor.setValue(key, value, options),
      log: message => console.log(message),
    });
    await Actor.fail(result.output.message);
  }
  const geoInput = text(input.geo, 'US');
  const geo = geoInput.toUpperCase() === 'WORLDWIDE' ? '' : geoInput;
  const anchor = text(input.anchor, '');
  const baselines = await loadBaselinesFromEnv();
  const proxyInput = actorProxyInput(input.proxyConfiguration);
  const hasCustomProxy = Array.isArray(proxyInput.proxyUrls) && proxyInput.proxyUrls.length > 0;

  let proxyTransport: Transport | undefined;
  if (Actor.isAtHome() || hasCustomProxy) {
    // Reuse the Actor SDK's proxy configuration and the existing HTTPS_PROXY path;
    // only the URL (and later the session id) is new here.
    const proxyConfiguration = await Actor.createProxyConfiguration(proxyInput as never);
    if (proxyConfiguration) {
      const session = new ApifyProxySession(proxyConfiguration);
      const url = await session.rotate();
      if (url) {
        proxyTransport = createRotatingTransport(session, {
          createTransport: proxyUrl => createDefaultTransport({ HTTPS_PROXY: proxyUrl }),
          onRotate: reason => console.log(`Rotated Apify proxy session after ${reason === 'rate_limited' ? 'HTTP 429' : reason === 'challenge' ? 'a Google challenge' : 'a failed proxy connection'}.`),
          onError: error => console.error(`Proxy rotation failed; keeping the current egress. ${error instanceof Error ? error.message : String(error)}`),
        });
        console.log('Egress: Apify proxy (rotates on HTTP 429 or a Google challenge).');
      } else if (Actor.isAtHome()) {
        throw new Error('Apify proxy returned no URL. Check that the selected proxy group and country are available to this account.');
      } else {
        console.warn('Apify proxy is unavailable locally; continuing with direct egress.');
      }
    } else {
      console.log('Egress: direct (proxy disabled in Actor input).');
    }
  } else {
    console.log('Egress: direct (outside the Apify platform).');
  }

  const snapshotDir = process.env.GTFA_SNAPSHOT_DIR || '/tmp/gtfa/snapshots';
  const chartDir = process.env.GTFA_CHART_DIR || '/tmp/gtfa/charts';
  const relayTransport = proxyTransport ?? createDefaultTransport();
  const tools: GtfaTool[] = createTools({
    transport: relayTransport,
    defaultGeo: geo,
    ...(anchor ? { anchor } : {}),
    ...(baselines ? { baselines } : {}),
    snapshotDir,
    chartDir,
    minIntervalMs: 1500,
  });

  if (!standby) {
    // One-off run: one tool, one dataset row per term, then exit.
    const result = await runOnce(input, {
      tools,
      pushData: item => Actor.pushData(item),
      setValue: (key, value, options) => Actor.setValue(key, value, options),
      log: message => console.log(message),
    });
    if (result.failed) await Actor.fail(result.output.message);
    else await Actor.exit();
  } else {
    const port = resolveStandbyPort();
    const idleEnv = process.env.GTFA_IDLE_EXIT_SECS?.trim();
    const idleSecsRaw = idleEnv ? Number(idleEnv) : 60;
    const idleSecs = Number.isFinite(idleSecsRaw) && idleSecsRaw >= 0 ? idleSecsRaw : 60;
    let http: HttpMcpServer | undefined;

    http = await startHttpMcpServer({
      port,
      host: '0.0.0.0',
      path: '/mcp',
      version,
      tools,
      transport: relayTransport,
      idleExit: {
        enabled: true,
        timeoutMs: idleSecs * 1000,
        log: message => console.log(message),
        exit: async () => {
          await http?.close();
          await Actor.exit();
        },
      },
      log: message => console.log(message),
      createMcpServer: () => createServer({
        defaultGeo: geo,
        ...(anchor ? { anchor } : {}),
        ...(baselines ? { baselines } : {}),
        snapshotDir,
        chartDir,
        transport: relayTransport,
      }),
    });

    // Never charge: this Actor only proxies MCP/HTTP requests and has no PPE events.
    console.log(`Standby MCP + HTTP ready on port ${http.port}: /mcp, /egress/fetch, /tools/{name}, /health (geo=${geo}, anchor=${anchor || 'auto'}).`);

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`Received ${signal}; shutting down.`);
      await http!.close();
      await Actor.exit();
    };
    process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.once('SIGINT', () => { void shutdown('SIGINT'); });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Actor failed to start');
  await Actor.exit({ exitCode: 1 });
}
