import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConfigPage, EN, ZH, deployApifyActor, fromSnapshot, loadApifyActors, loadApifyUsage, opsFor,
  resolveDeployBuild, withPendingAnchor, type ApifyActorsView, type ApifyUsageView, type Draft,
} from '../src/client/index.js';
import {
  APIFY_EST_COST_PER_CALL_USD, APIFY_FREE_MONTHLY_CREDIT_USD, APIFY_PRICING_URL, APIFY_SIGNUP_URL,
  GTFA_STORE_URL, apifyEstimatedCalls,
} from '../src/options.js';

const t = (key: string) => EN[key] ?? key;

function render(options: {
  value?: Record<string, unknown>;
  draft?: Partial<Draft>;
  usage?: ApifyUsageView;
  actors?: ApifyActorsView;
} = {}) {
  const snapshot = {
    status: 'ready' as const,
    revision: 1,
    writable: true,
    value: {
      egress: 'local',
      geo: 'US',
      cache: true,
      charts: true,
      snapshotDir: '.gtfa/snapshots',
      chartDir: '.gtfa/charts',
      baselines: {
        anchors: [{ term: 'chacha', geo: 'US', dailySearches: 1200, tolerance: 0.5 }],
        windowAnchors: { short: 'sudoku', long: 'chacha' },
      },
      ...options.value,
    },
  };
  const describeSnapshot = {
    view: {
      writable: true,
      namespaces: [{ ns: 'gtfa', secrets: [{ path: ['apifyToken'], set: true }] }],
    },
  };
  const form = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async () => true,
  };
  const describeFace = {
    getSnapshot: () => describeSnapshot,
    subscribe: () => () => {},
  };
  const ctx = {
    configForms: {
      get: () => form,
      describe: () => describeFace,
    },
  };
  return renderToStaticMarkup(createElement(ConfigPage, {
    ctx: ctx as never,
    t,
    initialDraft: options.draft,
    initialUsage: options.usage,
    initialActors: options.actors,
  }));
}

const readyUsage: ApifyUsageView = {
  status: 'ready',
  data: {
    plan: { tier: 'BRONZE', monthlyBasePriceUsd: 19, monthlyUsageCreditsUsd: 19 },
    usageUsd: 8.06,
    limitUsd: 19,
    cycle: { startAt: '2026-01-01T00:00:00.000Z', endAt: '2099-01-31T23:59:59.999Z' },
    residentialGb: 0.006,
    residentialGbLimit: 5,
    fetchedAt: '2026-01-15T12:34:00.000Z',
  },
};

const paidUsage: Extract<ApifyUsageView, { status: 'ready' }> = {
  status: 'ready',
  data: {
    ...readyUsage.data,
    plan: { tier: 'STARTER', monthlyBasePriceUsd: 19, monthlyUsageCreditsUsd: 19 },
    usageUsd: 8.0559,
    source: 'config',
  },
};

const freeUsage: Extract<ApifyUsageView, { status: 'ready' }> = {
  status: 'ready',
  data: {
    ...paidUsage.data,
    plan: { tier: 'FREE', monthlyBasePriceUsd: 0, monthlyUsageCreditsUsd: 5 },
    usageUsd: 1.25,
    limitUsd: 5,
  },
};

const oneActor: ApifyActorsView = {
  status: 'ready',
  actors: [{
    id: 'actor-1',
    name: 'google-trends-for-agent',
    username: 'alice',
    title: 'Google Trends for AI Agents',
    standbyUrl: 'https://alice--google-trends-for-agent.apify.actor',
    standbyEnabled: true,
    lastBuildId: 'build-1',
    lastBuildStatus: 'SUCCEEDED',
  }],
};

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

describe('dsh settings form', () => {
  it('renders choices as selects, a segmented control, and switches', () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(3);
    expect(html).toContain('aria-selected="true"');
    expect(html.match(/role="switch"/g)).toHaveLength(3);
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('<select');
    expect(html).toContain('United States (US)');
    expect(html).toContain('Worldwide');
    expect(html).toContain('Automatic (sudoku for ≤1 day, gpts for 7 days+)');
    expect(html).toContain('±50%');
  });

  it('orders sections and hides Apify fields while egress is local', () => {
    const html = render();
    const order = ['Connection', 'Defaults', 'Anchors &amp; baselines', 'Advanced'];
    const positions = order.map(title => html.indexOf(title));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).not.toContain('Apify usage');
    expect(html).not.toContain('Apify token');
    expect(html).not.toContain('>Actor<');
  });

  it('shows the usage card, token, and Actor select with build status for actor-own', () => {
    const html = render({ draft: { egress: 'actor-own', actor: 'actor-1' }, usage: readyUsage, actors: oneActor });
    expect(html).toContain('Apify usage');
    expect(html).toContain('$8.06 / $19.00');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('Plan: Bronze · $19/mo');
    expect(html).toContain('Residential proxy: 0.006 GB this cycle of 5.000 GB');
    expect(html).toContain('Apify token');
    expect(html).toContain('aria-label="Actor"');
    expect(html).toContain('alice/google-trends-for-agent — Google Trends for AI Agents');
    expect(html).toContain('Build: succeeded');
    expect(html).toContain('Refresh');
  });

  it('never renders the removed proxy group or country fields', () => {
    const html = render({ draft: { egress: 'actor-own', actor: 'actor-1' }, usage: readyUsage, actors: oneActor });
    for (const text of ['Proxy group', 'Proxy country', 'apifyProxyGroup', 'apifyProxyCountry', 'proxyGroup', 'proxyCountry']) {
      expect(html).not.toContain(text);
    }
  });

  it('shows the sign-up bar with the measured-cost estimate only when there is no token', () => {
    const html = render({ draft: { egress: 'actor-own' }, usage: { status: 'error', code: 'no-token' }, actors: { status: 'error', code: 'no-token' } });
    expect(html).toContain('No Apify account? Sign up free');
    expect(html).toContain('$5 monthly credit');
    expect(html).toContain(`roughly ${new Intl.NumberFormat('en').format(apifyEstimatedCalls())} calls a month at about $0.0024 per call, estimated`);
    expect(html).toContain(`href="${APIFY_SIGNUP_URL}"`);
    expect(html).toContain(`href="${APIFY_PRICING_URL}"`);
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('Sign up →');
    expect(html).toContain('Pricing');
  });

  it('hides the sign-up bar when a token exists or egress is local', () => {
    const paid = render({ draft: { egress: 'actor-own', actor: 'actor-1' }, usage: paidUsage, actors: oneActor });
    expect(paid).not.toContain('No Apify account?');
    expect(paid).not.toContain(`href="${APIFY_SIGNUP_URL}"`);

    const local = render({ usage: { status: 'error', code: 'no-token' } });
    expect(local).not.toContain('No Apify account?');
  });

  it('does not warn that Apify egress needs a paid plan', () => {
    const html = render({ draft: { egress: 'actor-own', actor: 'actor-1' }, usage: freeUsage, actors: oneActor });
    expect(html).not.toContain('needs a paid plan');
    expect(html).not.toContain('Free plan:');
    expect(html).not.toContain('Upgrade →');
  });

  it('keeps the public route read-only with source and Store links and no deploy controls', () => {
    const html = render({ draft: { egress: 'actor-public' }, usage: readyUsage, actors: oneActor });
    expect(html).toContain('Public Actor');
    expect(html).toContain('Actor: meka.im/google-trends-for-agent');
    expect(html).toContain('View source on GitHub →');
    expect(html).toContain('href="https://github.com/meka-im/google-trends-for-agent"');
    expect(html).toContain(`href="${GTFA_STORE_URL}" target="_blank" rel="noopener noreferrer">Apify Store page →</a>`);
    expect(html).toContain('About $0.0024 of platform usage per isolated call');
    expect(html).toContain('Apify token');
    expect(html).not.toContain('aria-label="Actor"');
    expect(html).not.toContain('Deploy to my Apify account');
  });

  it('offers one-click deploy and a manual link when the account has no matching Actor', () => {
    const html = render({ draft: { egress: 'actor-own' }, usage: readyUsage, actors: { status: 'ready', actors: [] } });
    expect(html).toContain('No google-trends-for-agent Actor in your account yet.');
    expect(html).toContain('Deploy to my Apify account →');
    expect(html).toContain('or deploy manually');
    expect(html).toContain('href="https://github.com/meka-im/google-trends-for-agent#deploy-it-yourself"');
    expect(html).toContain('aria-label="Actor"');
  });

  it('keeps the manual deploy anchor in both READMEs', () => {
    const en = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const zh = readFileSync(new URL('../README.zh-CN.md', import.meta.url), 'utf8');
    expect(en).toContain('### Deploy it yourself');
    expect(zh).toContain('<a id="deploy-it-yourself"></a>');
    expect(zh).toContain('### 自行部署');
  });

  it('shows Actor list loading and error states for actor-own', () => {
    const loading = render({ draft: { egress: 'actor-own' }, usage: readyUsage, actors: { status: 'loading' } });
    expect(loading).toContain('Loading your Actors…');
    const invalid = render({ draft: { egress: 'actor-own' }, usage: readyUsage, actors: { status: 'error', code: 'invalid-token' } });
    expect(invalid).toContain('Apify rejected the token');
    const network = render({ draft: { egress: 'actor-own' }, usage: readyUsage, actors: { status: 'error', code: 'network' } });
    expect(network).toContain('Could not load your Actors');
  });

  it('exposes the Apify sign-up, pricing, and cost constants', () => {
    expect(APIFY_SIGNUP_URL).toBe('https://console.apify.com/sign-up');
    expect(APIFY_PRICING_URL).toBe('https://apify.com/pricing');
    expect(APIFY_FREE_MONTHLY_CREDIT_USD).toBe(5);
    expect(APIFY_EST_COST_PER_CALL_USD).toBe(0.0024);
    expect(apifyEstimatedCalls()).toBe(2100);
  });

  it('keeps Advanced collapsed by default and shows its fields inside the disclosure', () => {
    const html = render();
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    expect(html).toContain('Snapshot directory');
    expect(html).toContain('Chart directory');
  });

  it('shows the unsaved pill and Discard after an edit, and disables Save', () => {
    const dirty = render({ draft: { cache: false } });
    expect(dirty).toContain('Unsaved changes');
    expect(dirty).toContain('Discard');
    expect(dirty).toMatch(/type="submit"[^>]*>Save<\/button>/);
    expect(dirty).not.toMatch(/type="submit"[^>]*disabled/);
    const clean = render();
    expect(clean).not.toContain('Unsaved changes');
  });

  it('shows inline validation next to invalid fields and blocks Save', () => {
    const html = render({
      draft: {
        newAnchor: { term: 'chacha', geo: 'US', dailySearches: '0', tolerance: '0.5' },
      },
    });
    expect(html).toContain('That anchor term is already in the list.');
    expect(html).toContain('Enter a positive daily searches value.');
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
  });

  it('warns about a token prefix without blocking Save', () => {
    const html = render({ draft: { egress: 'actor-own', token: 'not-an-apify-token' } });
    expect(html).toContain('Apify API tokens usually start with apify_api_. Double-check this one.');
    expect(html).not.toMatch(/type="submit"[^>]*disabled/);
  });

  it('derives fixed and window anchor options from built-ins and configured anchors', () => {
    const html = render();
    expect(html).toContain('<option value="gpts">gpts</option>');
    expect(html).toContain('<option value="sudoku">sudoku</option>');
    expect(html).toContain('<option value="chacha">chacha</option>');
    expect(html).toContain('aria-label="Short-window anchor"');
    expect(html).toContain('aria-label="Long-window anchor"');
    expect(html).toContain('aria-label="Geo chacha"');
  });

  it('keeps only the allowed text inputs', () => {
    const local = render();
    const localInputs = [...local.matchAll(/<input\b[^>]*>/g)].map(match => match[0]);
    expect(localInputs.filter(input => input.includes('type="text"'))).toHaveLength(3);
    expect(localInputs.filter(input => input.includes('type="password"'))).toHaveLength(0);
    expect(localInputs.filter(input => input.includes('type="number"'))).toHaveLength(2);
    expect(localInputs).toHaveLength(5);
    expect(local).not.toContain('<textarea');

    const apify = render({ draft: { egress: 'actor-own', actor: 'actor-1' }, usage: readyUsage, actors: oneActor });
    const apifyInputs = [...apify.matchAll(/<input\b[^>]*>/g)].map(match => match[0]);
    expect(apifyInputs.filter(input => input.includes('type="password"'))).toHaveLength(1);
    expect(apifyInputs).toHaveLength(6);
  });

  it('shows Worldwide as the empty geo option and tolerances as selects', () => {
    const html = render({ value: { geo: '' } });
    expect(html).toContain('<option value="" selected="">Worldwide</option>');
    expect(html).toContain('aria-label="Default geo"');
    // Anchors calibrate one country, so Worldwide appears only in the default-geo select.
    expect(html.match(/>Worldwide</g)).toHaveLength(1);
    expect(html.match(/aria-label="Tolerance /g)).toHaveLength(2);
    expect(html).toContain('<option value="0.1">±10%</option>');
    expect(html).toContain('<option value="1">±100%</option>');
  });

  it('keeps stored tolerances exactly instead of rounding them to a preset', () => {
    const html = render({ value: { baselines: { anchors: [
      { term: 'chacha', geo: 'US', dailySearches: 1200, tolerance: 0.2 },
      { term: 'pizza', geo: 'GB', dailySearches: 9000 },
    ] } } });
    expect(html).toContain('<option value="0.2" selected="">±20%</option>');
    expect(html).toMatch(/aria-label="Tolerance pizza"><option value="" selected="">Default \(±50%\)<\/option>/);
  });
});

describe('settings i18n and egress compatibility', () => {
  it('has the same keys in English and Chinese', () => {
    expect(Object.keys(ZH).sort()).toEqual(Object.keys(EN).sort());
    for (const key of ['egressLocal', 'egressPublic', 'egressOwn', 'egressRenamed', 'egressUnknown', 'testVersionMismatch', 'publicActorCost', 'viewSource', 'storePage']) {
      expect(EN[key], key).toBeTruthy();
      expect(ZH[key], key).toBeTruthy();
    }
  });

  it('migrates a saved apify egress to actor-own with a visible warning', () => {
    const draft = fromSnapshot({ egress: 'apify' });
    expect(draft).toMatchObject({ egress: 'actor-own', egressNotice: 'renamed' });
    const html = render({ value: { egress: 'apify' } });
    expect(html).toContain(EN.egressRenamed.replace(/"/g, '&quot;'));
    expect(html).toMatch(/type="submit"[^>]*>Save<\/button>/);
    expect(html).not.toMatch(/type="submit"[^>]*disabled/);
  });

  it('warns instead of silently treating any other unknown egress as local', () => {
    const draft = fromSnapshot({ egress: 'mcp' });
    expect(draft).toMatchObject({ egress: 'local', egressNotice: 'unknown' });
    expect(render({ value: { egress: 'mcp' } })).toContain(EN.egressUnknown);
  });

  it('unsets removed proxy keys on save when the profile still has them', () => {
    const draft = fromSnapshot({ egress: 'actor-own', apifyProxyGroup: 'RESIDENTIAL', apifyProxyCountry: 'US' });
    expect(draft.legacyKeys).toEqual(['apifyProxyGroup', 'apifyProxyCountry']);
    expect(opsFor(draft, t)).toEqual(expect.arrayContaining([
      { op: 'unset', path: ['apifyProxyGroup'] },
      { op: 'unset', path: ['apifyProxyCountry'] },
    ]));
    expect(opsFor(fromSnapshot({ egress: 'actor-own' }), t)).not.toEqual(expect.arrayContaining([
      { op: 'unset', path: ['apifyProxyGroup'] },
    ]));
  });
});

describe('deploy build latching', () => {
  it('ignores an unrelated succeeded Actor while the deployed build runs', () => {
    const actors = {
      status: 'ready' as const,
      actors: [
        ...actor('unrelated', 'other-build', 'SUCCEEDED').actors,
        ...actor('deployed', 'deployed-build', 'RUNNING').actors,
      ],
    };
    expect(resolveDeployBuild(actors, { actorId: 'deployed', buildId: 'deployed-build' })).toEqual({ status: 'pending' });
  });

  it('ignores an unrelated failed Actor', () => {
    const actors = {
      status: 'ready' as const,
      actors: [
        ...actor('unrelated', 'other-build', 'FAILED').actors,
        ...actor('deployed', 'deployed-build', 'RUNNING').actors,
      ],
    };
    expect(resolveDeployBuild(actors, { actorId: 'deployed', buildId: 'deployed-build' })).toEqual({ status: 'pending' });
  });

  it('selects exactly the returned Actor when its build succeeds', () => {
    const actors = {
      status: 'ready' as const,
      actors: [
        ...actor('unrelated', 'other-build', 'FAILED').actors,
        ...actor('deployed', 'deployed-build', 'SUCCEEDED').actors,
      ],
    };
    expect(resolveDeployBuild(actors, { actorId: 'deployed', buildId: 'deployed-build' }))
      .toEqual({ status: 'succeeded', actorId: 'deployed' });
  });

  it('fails only when the returned build id fails', () => {
    const stale = {
      status: 'ready' as const,
      actors: actor('deployed', 'older-build', 'FAILED').actors,
    };
    expect(resolveDeployBuild(stale, { actorId: 'deployed', buildId: 'deployed-build' })).toEqual({ status: 'pending' });
    const failed = {
      status: 'ready' as const,
      actors: actor('deployed', 'deployed-build', 'TIMED-OUT').actors,
    };
    expect(resolveDeployBuild(failed, { actorId: 'deployed', buildId: 'deployed-build' })).toEqual({ status: 'failed' });
  });
});

describe('saving the new-anchor row', () => {
  it('includes a filled-in new anchor instead of dropping it', () => {
    const base = { baselineOverride: true, anchors: [], newAnchor: { term: ' genie ', geo: 'GB', dailySearches: '120', tolerance: '' } } as unknown as Draft;
    const saved = withPendingAnchor(base);
    expect(saved.anchors).toEqual([{ term: 'genie', geo: 'GB', dailySearches: '120', tolerance: '' }]);
    expect(saved.newAnchor.term).toBe('');
    const off = { ...base, baselineOverride: false };
    expect(withPendingAnchor(off)).toBe(off);
  });
});

describe('Apify usage client helpers', () => {
  it('loads usage with a relative URL and refresh flag', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      source: 'config',
      plan: { tier: 'BRONZE', monthlyBasePriceUsd: 19, monthlyUsageCreditsUsd: 19 },
      usageUsd: 8.06,
      limitUsd: 19,
      cycle: { startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-01-31T23:59:59.999Z' },
      residentialGb: 0.006,
      residentialGbLimit: 5,
      fetchedAt: '2026-01-15T12:34:00.000Z',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadApifyUsage(true)).toMatchObject({ status: 'ready', data: { usageUsd: 8.06, limitUsd: 19 } });
    expect(fetchMock).toHaveBeenCalledWith('api/gtfa.apify-usage?refresh=1', expect.objectContaining({ cache: 'no-store' }));
  });

  it('maps no-token and invalid-token responses for the card', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, code: 'no-token' }), { status: 200 })));
    expect(await loadApifyUsage()).toEqual({ status: 'error', code: 'no-token' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, code: 'invalid-token', status: 401 }), { status: 200 })));
    expect(await loadApifyUsage()).toEqual({ status: 'error', code: 'invalid-token', httpStatus: 401 });
  });
});

describe('Apify Actor client helpers', () => {
  it('loads the Actor list with a relative URL and refresh flag', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      actors: [{
        id: 'actor-1',
        name: 'google-trends-for-agent',
        username: 'alice',
        title: 'Google Trends for AI Agents',
        standbyUrl: 'https://alice--google-trends-for-agent.apify.actor',
        standbyEnabled: true,
        lastBuildId: 'build-1',
        lastBuildStatus: 'SUCCEEDED',
      }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await loadApifyActors(true)).toEqual({ status: 'ready', actors: oneActor.actors });
    expect(fetchMock).toHaveBeenCalledWith('api/gtfa.apify-actors?refresh=1', expect.objectContaining({ cache: 'no-store' }));
  });

  it('maps Actor list errors and the deploy response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, code: 'no-token' }), { status: 200 })));
    expect(await loadApifyActors()).toEqual({ status: 'error', code: 'no-token' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, actorId: 'actor-1', buildId: 'build-1' }), { status: 200 })));
    expect(await deployApifyActor()).toEqual({ ok: true, actorId: 'actor-1', buildId: 'build-1' });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, code: 'exists' }), { status: 200 })));
    expect(await deployApifyActor()).toEqual({ ok: false, code: 'exists' });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await deployApifyActor()).toEqual({ ok: false, code: 'network' });
  });
});
