// Run in a child process against an installed, published dsh and packed gtfa.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const stage = process.argv[2];
assert.ok(stage, 'An isolated installation directory is required');
const require = createRequire(join(stage, 'package.json'));
const load = spec => import(pathToFileURL(require.resolve(spec)).href);
const { runProfile } = await load('@deepseek-ai/dsh/profile-boot');
const { loadProfileDirectory } = await load('@deepseek-ai/dsh-app-boot');
const { createLaunchEnvironmentSnapshot } = await load('@deepseek-ai/dsh-launch-environment');
const { MockAgent, setGlobalDispatcher } = await load('undici');
const dispatcher = new MockAgent();
dispatcher.disableNetConnect();
setGlobalDispatcher(dispatcher);
const unexpectedFetches = [];
globalThis.fetch = async url => {
  unexpectedFetches.push(String(url));
  throw new Error('External HTTP is disabled in the compatibility driver');
};

const installAnchor = require.resolve('@deepseek-ai/dsh/package.json');
const pluginRoot = dirname(require.resolve('google-trends-for-agent/package.json'));
const { createApifyOAuthManager } = await import(pathToFileURL(join(pluginRoot, 'dist/apify-oauth.js')).href);
const home = join(stage, 'home');
const profileDir = join(home, 'profiles', 'compat');
await mkdir(profileDir, { recursive: true, mode: 0o700 });
await writeFile(join(profileDir, 'package.json'), JSON.stringify({
  name: 'gtfa-compat-profile', private: true,
  dsh: { profile: { bundles: ['google-trends-for-agent'] } },
}));
await writeFile(join(profileDir, 'cordis.patch.yml'), JSON.stringify([{ insert: [
  { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt' },
  { id: 'tools', name: '@deepseek-ai/dsh-tools' },
  { id: 'credentials', name: '@deepseek-ai/dsh-credentials-local', config: { dshHome: home, watch: false } },
  { id: 'config-editor', name: '@deepseek-ai/dsh-config-editor' },
  { id: 'settings', name: '@deepseek-ai/dsh-settings' },
] }]));
const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: {
  DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
} }]);
const boot = () => runProfile({ environment, profile: 'compat', patchFiles: [], args: [],
  resolvedProfile: { profile: loadProfileDirectory('gtfa-compat', profileDir, installAnchor), installAnchor } });
const toolNames = ['trends_ask', 'trends_compare', 'trends_now', 'trends_snapshot'];
const report = { dsh: JSON.parse(await readFile(installAnchor, 'utf8')).version };
let runtime;
let manager;
try {
  runtime = await boot();
  const tools = runtime.ctx.get('tools');
  assert.ok(tools, 'The real dsh tools service must load');
  assert.deepEqual(tools.schemas().map(row => row.name).sort(), [...toolNames].sort());
  for (const name of toolNames) assert.ok(tools.get(name), `${name} must be registered`);
  // Exercise the registered producer contract gtfa implements. Host executor/batch APIs
  // differ across these releases and are not APIs this plugin calls.
  const rejected = await tools.get('trends_ask').execute({ term: '' }, { signal: new AbortController().signal });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'INVALID_INPUT');
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(tools.get('trends_ask').execute({ term: 'unused' }, { signal: cancelled.signal }),
    error => error.name === 'AbortError');
  report.toolsRegistered = true;
  report.invalidInputStoppedBeforeNetwork = true;
  report.cancellationStoppedBeforeWork = true;

  const settings = runtime.ctx.get('settings');
  assert.ok(settings, 'The real dsh Config-derived forms must load');
  const before = settings.describe({ redactSecrets: true }).find(row => row.ns === 'gtfa');
  assert.ok(before, 'The gtfa entry must expose its volatile Config');
  await settings.mutate('gtfa', [
    { op: 'set', path: ['geo'], value: 'GB' },
    { op: 'set', path: ['apifyToken'], value: 'compat-config-placeholder' },
  ], before.revision);
  const after = settings.describe({ redactSecrets: true }).find(row => row.ns === 'gtfa');
  assert.equal(after.value.geo, 'GB');
  assert.ok(!JSON.stringify(after).includes('compat-config-placeholder'), 'Form reads must redact credentials');
  await assert.rejects(settings.mutate('gtfa', [{ op: 'set', path: ['geo'], value: 'US' }], before.revision));
  assert.equal(settings.describe({ redactSecrets: true }).find(row => row.ns === 'gtfa').value.geo, 'GB');
  assert.match(await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8'), /GB/);
  report.configPersistedAndRedacted = true;
  report.staleWriteRejected = true;

  let clock = 1_800_000_000_000;
  const token = 'compat-oauth-placeholder';
  const oauthFetch = async url => {
    const path = String(url);
    if (path.endsWith('/.well-known/oauth-authorization-server')) return Response.json({
      issuer: 'https://console-backend.apify.com', registration_endpoint: 'https://console-backend.apify.com/oauth/apps',
      device_authorization_endpoint: 'https://console-backend.apify.com/oauth/apps/devices',
      token_endpoint: 'https://console-backend.apify.com/oauth/apps/token',
    });
    if (path.endsWith('/oauth/apps')) return Response.json({ client_id: 'compat-client' }, { status: 201 });
    if (path.endsWith('/oauth/apps/devices')) return Response.json({ device_code: 'compat-device', user_code: 'TEST-ONLY',
      verification_uri: 'https://console.apify.com/authorize/device', expires_in: 600, interval: 5 });
    if (path.endsWith('/oauth/apps/token')) return Response.json({ access_token: token, token_type: 'Bearer' });
    throw new Error('Unexpected fixture OAuth path');
  };
  const oauthOptions = ctx => ({ credentials: () => ctx.get('credentials'), fetch: oauthFetch, now: () => clock });
  manager = createApifyOAuthManager(oauthOptions(runtime.ctx));
  assert.equal((await manager.start()).pending, true);
  clock += 5_001;
  assert.equal((await manager.status()).connected, true);
  assert.equal((await manager.resolveToken()).token, token);
  report.oauthStoredThroughHost = true;
  manager.dispose(); manager = undefined;
  await runtime.shutdown.shutdown(0); runtime = undefined;

  runtime = await boot();
  assert.equal(runtime.ctx.get('settings').describe({ redactSecrets: true }).find(row => row.ns === 'gtfa').value.geo, 'GB');
  manager = createApifyOAuthManager(oauthOptions(runtime.ctx));
  assert.equal((await manager.status()).connected, true);
  assert.equal((await manager.resolveToken()).token, token);
  report.restartRestoredConfigAndOAuth = true;
  await manager.logout();
  assert.equal((await manager.status()).connected, false);
  assert.equal((await manager.resolveToken()).token, undefined);
  report.logoutRemovedHostSession = true;
  assert.deepEqual(unexpectedFetches, []);
  console.log('GTFA_COMPAT_RESULT ' + JSON.stringify(report));
} finally {
  manager?.dispose();
  if (runtime) await runtime.shutdown.shutdown(0);
  await dispatcher.close();
}
