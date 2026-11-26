import { Actor } from 'apify';
import { isStandbyRun } from './http.js';
import { ACTOR_RESPONSE_KEY, runToolRequest } from './actor-request.js';
import { createRotatingTransport, resolveActorProxySession } from './actor-proxy.js';
import { createDefaultTransport, errorLabel, type Transport } from './transport.js';
import { createTools, type GtfaTool } from './tools.js';
import { loadBaselinesFromEnv } from './traffic.js';
import { actorFailMessage, runOnce, validateActorRunInput, type ActorRunInput } from './actor-run.js';
import { ACTOR_RUNTIME_KEY } from './actor-runtime.js';
import { VERSION } from './version.js';
import { currentMekaBaselineVersion } from './dsh-baselines.js';

interface ActorInput extends ActorRunInput {
  proxyConfiguration?: Record<string, unknown>;
  anchor?: string;
  geo?: string;
  toolRequest?: unknown;
}

const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;

const standby = isStandbyRun();

await Actor.init();

try {
  if (standby) throw new Error('Standby serving is disabled. Use an on-demand Actor run or the official Apify MCP gateway.');
  await Actor.setValue(ACTOR_RUNTIME_KEY, { version: VERSION, baselineCatalogRevision: currentMekaBaselineVersion() });
  const input = (await Actor.getInput<ActorInput>()) ?? {};
  if (input.toolRequest === undefined && validateActorRunInput(input)) {
    // Fail fast without building a proxy or tools for an input we cannot run.
    const result = await runOnce(input, {
      pushData: item => Actor.pushData(item),
      setValue: (key, value, options) => Actor.setValue(key, value, options),
      log: message => console.log(message),
    });
    await Actor.fail(actorFailMessage(result.output));
  }
  const geoInput = text(input.geo, 'US');
  const geo = geoInput.toUpperCase() === 'WORLDWIDE' ? '' : geoInput;
  const anchor = text(input.anchor, '');
  const baselines = await loadBaselinesFromEnv();
  let proxyTransport: Transport | undefined;
  const resolvedProxy = await resolveActorProxySession(input.proxyConfiguration, {
    isAtHome: Actor.isAtHome(),
    createProxyConfiguration: cfg => Actor.createProxyConfiguration(cfg as never),
    onFallback: message => console.warn(message),
  });
  if (resolvedProxy.session) {
    proxyTransport = createRotatingTransport(resolvedProxy.session, {
      createTransport: proxyUrl => createDefaultTransport({ HTTPS_PROXY: proxyUrl }),
      onRotate: reason => console.log(`Rotated Apify proxy session after ${reason === 'rate_limited' ? 'HTTP 429' : reason === 'challenge' ? 'a Google challenge' : 'a failed proxy connection'}.`),
      onError: error => console.error(`Proxy rotation failed; keeping the current egress (${errorLabel(error)}).`),
    });
    console.log(
      resolvedProxy.mode === 'fallback-auto-proxy'
        ? 'Egress: default Apify proxy fallback (rotates on HTTP 429 or a Google challenge).'
        : 'Egress: Apify proxy (rotates on HTTP 429 or a Google challenge).',
    );
  } else if (resolvedProxy.mode === 'disabled') {
    console.log('Egress: direct (proxy disabled in Actor input).');
  } else if (resolvedProxy.mode === 'direct-fallback') {
    console.log('Egress: direct fallback (Apify proxy unavailable).');
  } else {
    console.log('Egress: direct (outside the Apify platform).');
  }

  const snapshotDir = process.env.GTFA_SNAPSHOT_DIR || '/tmp/gtfa/snapshots';
  const chartDir = process.env.GTFA_CHART_DIR || '/tmp/gtfa/charts';
  const relayTransport = proxyTransport ?? createDefaultTransport();
  const retryOptions = proxyTransport ? { defaultMaxRetries: 2 as const } : {};
  const tools: GtfaTool[] = createTools({
    transport: relayTransport,
    defaultGeo: geo,
    ...(anchor ? { anchor } : {}),
    ...(baselines ? { baselines } : {}),
    snapshotDir,
    chartDir,
    minIntervalMs: 1500,
    ...retryOptions,
  });

  if (input.toolRequest !== undefined) {
    const response = await runToolRequest(input.toolRequest, {
      snapshotDir, chartDir,
      create: settings => createTools({ ...settings, settings: () => settings, transport: relayTransport, minIntervalMs: 1500, ...retryOptions }),
    });
    await Actor.setValue(ACTOR_RESPONSE_KEY, response);
    await Actor.exit();
  } else {
    const result = await runOnce(input, {
      tools,
      pushData: item => Actor.pushData(item),
      setValue: (key, value, options) => Actor.setValue(key, value, options),
      log: message => console.log(message),
    });
    if (result.failed) await Actor.fail(actorFailMessage(result.output));
    else await Actor.exit();
  }
} catch (error) {
  console.error(`Actor failed to start (${errorLabel(error)}).`);
  await Actor.exit({ exitCode: 1 });
}
