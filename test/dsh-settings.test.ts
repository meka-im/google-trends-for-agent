import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigPage, EN, loadApifyUsage, type ApifyUsageView, type Draft } from '../src/client/index.js';

const t = (key: string) => EN[key] ?? key;

function render(options: {
  value?: Record<string, unknown>;
  draft?: Partial<Draft>;
  usage?: ApifyUsageView;
} = {}) {
  const snapshot = {
    status: 'ready' as const,
    revision: 1,
    writable: true,
    value: {
      egress: 'local',
      apifyProxyGroup: 'RESIDENTIAL',
      apifyProxyCountry: 'US',
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dsh settings form', () => {
  it('renders choices as selects, a segmented control, and switches', () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toContain('aria-selected="true"');
    expect(html.match(/role="switch"/g)).toHaveLength(3);
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('<select');
    expect(html).toContain('United States (US)');
    expect(html).toContain('Worldwide');
    expect(html).toContain('Automatic (sudoku for ≤1 day, gpts for 7 days+)');
    expect(html).toContain('±50%');
    expect(html).not.toContain('apifyProxyGroups');
  });

  it('orders sections and hides Apify fields while egress is local', () => {
    const html = render();
    const order = ['Connection', 'Defaults', 'Anchors &amp; baselines', 'Advanced'];
    const positions = order.map(title => html.indexOf(title));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).not.toContain('Apify usage');
    expect(html).not.toContain('Apify token');
    expect(html).not.toContain('Proxy group');
  });

  it('shows the Apify section, usage card values, and plan line when egress is apify', () => {
    const html = render({ draft: { egress: 'apify' }, usage: readyUsage });
    expect(html).toContain('Apify usage');
    expect(html).toContain('$8.06 / $19.00');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('Plan: Bronze · $19/mo');
    expect(html).toContain('Residential proxy: 0.006 GB this cycle of 5.000 GB');
    expect(html).toContain('Updated');
    expect(html).toContain('Resets');
    expect(html).toContain('Apify token');
    expect(html).toContain('Proxy group');
    expect(html).toContain('value="auto"');
    expect(html).toContain('Datacenter (automatic)');
  });

  it('renders no-token and invalid-token usage states', () => {
    const noToken = render({ draft: { egress: 'apify' }, usage: { status: 'error', code: 'no-token' } });
    expect(noToken).toContain('Add an Apify token (or set APIFY_TOKEN) to see usage.');
    expect(noToken).toContain('Refresh');

    const invalid = render({ draft: { egress: 'apify' }, usage: { status: 'error', code: 'invalid-token' } });
    expect(invalid).toContain('Apify rejected the token (401). Check it in Apify Console → Settings → API &amp; Integrations.');
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
    const html = render({ draft: { egress: 'apify', token: 'not-an-apify-token' } });
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

    const apify = render({ draft: { egress: 'apify' }, usage: readyUsage });
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
