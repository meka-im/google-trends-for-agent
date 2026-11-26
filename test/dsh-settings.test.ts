import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APIFY_OAUTH_VERIFICATION_URL, EN, ZH, apply, deployApifyActor, fromSnapshot, loadApifyActors,
  loadApifyOAuth, loadApifyUsage, normalizeApifyOAuthStatus, opsFor, resolveDeployBuild,
  setBaselineOverride, startApifyOAuth, validateDraft, withPendingAnchor,
  type ApifyActorsView, type Draft,
} from '../src/client/index.js';

const t = (key: string) => EN[key] ?? key;

function actor(id: string, buildId: string | null, buildStatus: string | null): ApifyActorsView {
  return {
    status: 'ready',
    actors: [{
      id,
      name: 'google-trends-for-agent',
      username: 'alice',
      title: 'Google Trends for AI Agents',
      standbyUrl: `https://alice--${id}.apify.actor`,
      standbyEnabled: true,
      lastBuildId: buildId,
      lastBuildStatus: buildStatus,
    }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settings i18n and egress compatibility', () => {
  it('has the same keys in English and Chinese', () => {
    expect(Object.keys(ZH).sort()).toEqual(Object.keys(EN).sort());
    for (const key of ['egressLocal', 'egressPublic', 'egressOwn', 'egressRenamed', 'egressUnknown', 'testVersionMismatch']) {
      expect(EN[key], key).toBeTruthy();
      expect(ZH[key], key).toBeTruthy();
    }
  });

  it('migrates legacy egress values and unsets removed proxy keys on save', () => {
    expect(fromSnapshot({ egress: 'apify' })).toMatchObject({ egress: 'actor-own', egressNotice: 'renamed' });
    expect(fromSnapshot({ egress: 'mcp' })).toMatchObject({ egress: 'local', egressNotice: 'unknown' });
    const legacy = fromSnapshot({ egress: 'actor-own', apifyProxyGroup: 'RESIDENTIAL', apifyProxyCountry: 'US' });
    expect(legacy.legacyKeys).toEqual(['apifyProxyGroup', 'apifyProxyCountry']);
    expect(opsFor(legacy, t)).toEqual(expect.arrayContaining([
      { op: 'unset', path: ['apifyProxyGroup'] },
      { op: 'unset', path: ['apifyProxyCountry'] },
    ]));
    expect(opsFor(fromSnapshot({ egress: 'actor-own' }), t)).not.toEqual(expect.arrayContaining([
      { op: 'unset', path: ['apifyProxyGroup'] },
    ]));
  });
});

describe('deploy build latching', () => {
  it('tracks only the returned actor and build id across pending, succeeded, and failed states', () => {
    const running: ApifyActorsView = {
      status: 'ready',
      actors: [...actor('unrelated', 'other-build', 'SUCCEEDED').actors, ...actor('deployed', 'deployed-build', 'RUNNING').actors],
    };
    expect(resolveDeployBuild(running, { actorId: 'deployed', buildId: 'deployed-build' })).toEqual({ status: 'pending' });

    const stale = actor('deployed', 'older-build', 'FAILED');
    expect(resolveDeployBuild(stale, { actorId: 'deployed', buildId: 'deployed-build' })).toEqual({ status: 'pending' });

    const succeeded: ApifyActorsView = {
      status: 'ready',
      actors: [...actor('unrelated', 'other-build', 'FAILED').actors, ...actor('deployed', 'deployed-build', 'SUCCEEDED').actors],
    };
    expect(resolveDeployBuild(succeeded, { actorId: 'deployed', buildId: 'deployed-build' }))
      .toEqual({ status: 'succeeded', actorId: 'deployed' });

    const failed = actor('deployed', 'deployed-build', 'TIMED-OUT');
    expect(resolveDeployBuild(failed, { actorId: 'deployed', buildId: 'deployed-build' })).toEqual({ status: 'failed' });
  });
});

describe('baseline draft helpers', () => {
  it('seeds MEKA US defaults, includes pending new rows, and validates duplicates per region', () => {
    const draft = setBaselineOverride(fromSnapshot(undefined), true);
    expect(draft.anchors).toEqual([{ term: 'sudoku', geo: 'US', dailySearches: '88000', tolerance: '0.5' }]);

    expect(validateDraft({
      ...draft,
      newAnchor: { term: 'sudoku', geo: 'US', dailySearches: '100', tolerance: '0.5' },
    }, t).newAnchorTerm).toBe(EN.duplicateAnchor);
    expect(validateDraft({
      ...draft,
      newAnchor: { term: 'sudoku', geo: 'GB', dailySearches: '100', tolerance: '0.5' },
    }, t).newAnchorTerm).toBeUndefined();

    const base = { baselineOverride: true, anchors: [], newAnchor: { term: ' genie ', geo: 'GB', dailySearches: '120', tolerance: '' } } as unknown as Draft;
    const saved = withPendingAnchor(base);
    expect(saved.anchors).toEqual([{ term: 'genie', geo: 'GB', dailySearches: '120', tolerance: '' }]);
    expect(saved.newAnchor.term).toBe('');
    expect(withPendingAnchor({ ...base, baselineOverride: false }).anchors).toEqual([]);
  });
});

describe('Apify client helpers and OAuth URL validation', () => {
  it('loads usage and Actor lists with relative URLs and maps errors', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.startsWith('api/gtfa.apify-usage')) {
        return Response.json({
          ok: true, source: 'oauth',
          plan: { tier: 'BRONZE', monthlyBasePriceUsd: 19, monthlyUsageCreditsUsd: 19 },
          usageUsd: 8.06, limitUsd: 19,
          cycle: { startAt: '2026-01-01T00:00:00.000Z', endAt: '2099-01-31T23:59:59.999Z' },
          residentialGb: 0.006, residentialGbLimit: 5, fetchedAt: '2026-01-15T12:34:00.000Z',
        });
      }
      if (target.startsWith('api/gtfa.apify-actors')) {
        return Response.json({ ok: true, actors: actor('actor-1', 'build-1', 'SUCCEEDED').actors });
      }
      return Response.json({ ok: true, actorId: 'actor-1', buildId: 'build-1' });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadApifyUsage(true)).toMatchObject({ status: 'ready', data: { source: 'oauth', usageUsd: 8.06 } });
    expect(fetchMock).toHaveBeenCalledWith('api/gtfa.apify-usage?refresh=1', expect.objectContaining({ cache: 'no-store' }));
    expect(await loadApifyActors(true)).toEqual(actor('actor-1', 'build-1', 'SUCCEEDED'));
    expect(fetchMock).toHaveBeenCalledWith('api/gtfa.apify-actors?refresh=1', expect.objectContaining({ cache: 'no-store' }));
    expect(await deployApifyActor()).toEqual({ ok: true, actorId: 'actor-1', buildId: 'build-1' });

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: false, code: 'invalid-token', status: 401 })));
    expect(await loadApifyUsage()).toEqual({ status: 'error', code: 'invalid-token', httpStatus: 401 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await deployApifyActor()).toEqual({ ok: false, code: 'network' });
  });

  it('drops unsafe OAuth verification URLs and uses exact relative OAuth routes', async () => {
    const base = { available: true, connected: false, pending: true };
    for (const verificationUri of [
      'javascript:alert(document.domain)',
      'https://evil.example/authorize/device',
      'https://console.apify.com/not-a-device-page',
      'https://console.apify.com:443/authorize/device',
      'https://console.apify.com/authorize/device#fragment',
    ]) {
      expect(normalizeApifyOAuthStatus({ ...base, verificationUri })?.verificationUri).toBeUndefined();
    }
    expect(APIFY_OAUTH_VERIFICATION_URL).toBe('https://console.apify.com/authorize/device');
    expect(normalizeApifyOAuthStatus({ ...base, verificationUri: 'https://console.apify.com/authorize/device/?code=ABC' })?.verificationUri)
      .toBe('https://console.apify.com/authorize/device/?code=ABC');
    expect(normalizeApifyOAuthStatus({ ...base, available: 'true' })).toBeNull();
    expect(normalizeApifyOAuthStatus({ ...base, code: 'unknown-code' })).toBeNull();

    const fetchMock = vi.fn(async () => Response.json({
      ...base, verificationUri: 'https://console.apify.com/authorize/device?code=ABC', userCode: 'ABCD-1234', expiresAt: '2099-01-15T12:34:00.000Z',
    }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadApifyOAuth()).toMatchObject({ status: 'ready', data: { pending: true } });
    expect(fetchMock).toHaveBeenLastCalledWith('api/gtfa.apify-oauth', expect.objectContaining({ method: 'GET', cache: 'no-store' }));
    expect(await startApifyOAuth()).toMatchObject({ status: 'ready', data: { pending: true } });
    expect(fetchMock).toHaveBeenLastCalledWith('api/gtfa.apify-oauth-start', expect.objectContaining({ method: 'POST', cache: 'no-store' }));
  });

  it('registers plugins.row.config cleanly and embeds 1-click settings inside the Dashboard panel', () => {
    const registrations: Array<{ slot: string; options: Record<string, unknown>; component: (props: Record<string, unknown>) => unknown }> = [];
    const openBundle = vi.fn();
    const ctx = {
      get: (name: string) => (name === 'pluginNavigation' ? { openBundle } : undefined),
      effect: (cb: () => unknown) => { cb(); },
      locale: {
        register: vi.fn(),
        bind: () => (key: string) => EN[key] ?? key,
      },
      slots: {
        inject: (_name: string, reg: () => unknown) => reg(),
        register: (options: Record<string, unknown>, component: (props: Record<string, unknown>) => unknown) => {
          registrations.push({ slot: String(options.name), options, component });
          return () => {};
        },
      },
      configForms: {
        get: vi.fn(),
        describe: vi.fn(),
      },
    };

    apply(ctx as never);

    expect(registrations.find(entry => entry.slot === 'plugins.bundle.config')).toBeUndefined();
    const rowConfig = registrations.find(entry => entry.slot === 'plugins.row.config');
    expect(rowConfig?.options).toMatchObject({ name: 'plugins.row.config', key: 'google-trends-for-agent#gtfa' });

    const mainSlot = registrations.find(entry => entry.slot === 'main');
    expect(mainSlot).toBeDefined();
    const element = mainSlot!.component({}) as { props: { openSettings: () => void; renderSettings?: () => unknown } };
    expect(typeof element.props.renderSettings).toBe('function');
    element.props.openSettings();
    expect(openBundle).toHaveBeenCalledWith('google-trends-for-agent');
  });
});
