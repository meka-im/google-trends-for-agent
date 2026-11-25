// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigPage, ConnectionTestResults, EN, type ConfigPageProps } from '../src/client/index.js';
import { CONNECTION_FILTER, CONNECTION_KEYWORDS } from '../src/connection-check.js';
import { setActiveMekaBaselines, summarizeMekaCatalog } from '../src/dsh-baselines.js';
import { regionLabel } from '../src/options.js';

type PathOp = { op: 'set' | 'unset'; path: string[]; value?: unknown };
const t = (key: string) => EN[key] ?? key;

/** An observable Host boundary: the page must submit operations to change saved state. */
function host(initial: Record<string, unknown> = {}, writable = true) {
  let snapshot = { status: 'ready' as const, revision: 1, writable,
    value: { egress: 'local', geo: 'US', cache: true, charts: true,
      snapshotDir: '.gtfa/snapshots', chartDir: '.gtfa/charts', ...initial } as Record<string, unknown> };
  const listeners = new Set<() => void>();
  const describe = { view: { writable, namespaces: [{ ns: 'gtfa', secrets: [] }] } };
  const mutate = vi.fn(async (ops: readonly PathOp[], revision?: number) => {
    if (!writable || revision !== snapshot.revision) return false;
    const value = structuredClone(snapshot.value);
    for (const op of ops) {
      let parent = value;
      for (const part of op.path.slice(0, -1)) parent = parent[part] as Record<string, unknown>;
      const key = op.path.at(-1)!;
      if (op.op === 'unset') delete parent[key];
      else parent[key] = op.value;
    }
    snapshot = { ...snapshot, revision: snapshot.revision + 1, value };
    for (const listener of listeners) listener();
    return true;
  });
  const ctx = { configForms: {
    get: () => ({ getSnapshot: () => snapshot, subscribe: (fn: () => void) => {
      listeners.add(fn); return () => listeners.delete(fn);
    }, mutate }),
    describe: () => ({ getSnapshot: () => describe, subscribe: () => () => {} }),
  } } as unknown as ConfigPageProps['ctx'];
  return { ctx, mutate, saved: () => snapshot.value, subscribers: () => listeners.size };
}

function api() {
  let oauth = { available: true, connected: false, pending: false } as Record<string, unknown>;
  let actorFailure = false;
  const requests: Array<{ url: string; method: string; body?: BodyInit | null; signal?: AbortSignal | null }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    requests.push({ url: path, method: init?.method ?? 'GET', body: init?.body, signal: init?.signal });
    if (path === 'api/gtfa.apify-oauth-start') oauth = { available: true, connected: false, pending: true,
      userCode: 'TEST-ONLY', verificationUri: 'https://console.apify.com/authorize/device',
      expiresAt: '2099-01-01T00:00:00.000Z' };
    if (path === 'api/gtfa.apify-oauth-cancel' || path === 'api/gtfa.apify-oauth-logout') {
      oauth = { available: true, connected: false, pending: false };
    }
    if (path.startsWith('api/gtfa.apify-oauth')) return Response.json(oauth);
    if (path.startsWith('api/gtfa.apify-usage')) return Response.json({ ok: false, code: 'no-token' });
    if (path.startsWith('api/gtfa.apify-actors')) {
      if (!oauth.connected) return Response.json({ ok: false, code: 'no-token' });
      if (actorFailure) return Response.json({ ok: false, code: 'network' });
      return Response.json({ ok: true, actors: ['actor-one', 'actor-two'].map(id => actorRow(id)) });
    }
    if (path === 'api/gtfa.test-connection') {
      const { egress } = JSON.parse(String(init?.body));
      const result = diagnostic();
      return Response.json({ ...result, egress, network: { ...result.network, egress } });
    }
    if (path === 'api/gtfa.baselines') {
      return Response.json(summarizeMekaCatalog());
    }
    if (path.startsWith('api/gtfa.version')) {
      return Response.json({
        pluginVersion: '0.2.40',
        baselineCatalogRevision: '2026-11-19',
        egress: 'local',
        actorId: null,
        latestRelease: null,
        pluginUpdateAvailable: false,
        observedActor: null,
        actorUpdateAvailable: false,
        checkedAt: '2026-11-21T00:00:00.000Z',
        checkError: null,
      });
    }
    if (path === 'api/gtfa.baselines-sync') {
      const status = {
        ...summarizeMekaCatalog(),
        source: 'synced',
        version: '2026-11-20',
        syncedAt: '2026-11-20T07:30:00.000Z',
      };
      return Response.json({ ok: true, updated: true, status });
    }
    throw new Error(`Unexpected request in interaction test: ${path}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { requests, fetch, setOAuth: (value: Record<string, unknown>) => { oauth = value; },
    failActors: (value: boolean) => { actorFailure = value; },
    count: (path: string) => requests.filter(row => row.url === path).length };
}

function actorRow(id: string, status = 'SUCCEEDED', buildId = 'build-one') {
  return { id, name: 'google-trends-for-agent', username: 'tester', title: id,
    standbyUrl: null, standbyEnabled: false, lastBuildId: buildId, lastBuildStatus: status };
}

function diagnostic() {
  return { ok: true, egress: 'local', settingsSource: 'draft', status: 200, latencyMs: 4, checkedAt: '2026-11-16T00:00:00.000Z',
    network: { ok: true, egress: 'local', status: 200, latencyMs: 1 },
    data: { ok: true, latencyMs: 3, ...CONNECTION_FILTER,
      keywords: CONNECTION_KEYWORDS.map(keyword => ({ keyword, status: 'ok', points: 12, nonzeroPoints: 10 })) } };
}

const button = (key: string) => screen.getByRole('button', { name: t(key) }) as HTMLButtonElement;
const chooseGeo = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
  const input = screen.getByRole('combobox', { name: t('geo') });
  await user.click(input);
  await user.clear(input);
  await user.type(input, code);
  await user.click(screen.getByRole('option', { name: regionLabel(code, 'en') }));
};
const expectKeywordCounts = () => {
  for (const keyword of CONNECTION_KEYWORDS) {
    const row = screen.getByRole('rowheader', { name: keyword }).closest('tr')!;
    expect(within(row).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['12', '10', t('diagnosticPass')]);
  }
};
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

afterEach(() => {
  cleanup();
  setActiveMekaBaselines(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('settings interactions', () => {
  it('aborts a pending Actor list on route changes and ignores its late result', async () => {
    const backend = host({ egress: 'actor-own' }); const network = api(); const user = userEvent.setup();
    network.setOAuth({ available: true, connected: true, pending: false });
    const original = network.fetch.getMockImplementation()!;
    const pending: Array<{ signal?: AbortSignal | null; resolve: (response: Response) => void }> = [];
    network.fetch.mockImplementation((url, init) => String(url).startsWith('api/gtfa.apify-actors')
      ? new Promise(resolve => { pending.push({ signal: init?.signal, resolve }); }) : original(url, init));
    const page = render(<ConfigPage ctx={backend.ctx} t={t} />);
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    await user.click(screen.getByRole('tab', { name: t('egressPublic') }));
    expect(pending.every(request => request.signal?.aborted)).toBe(true);
    await act(async () => { for (const request of pending) request.resolve(Response.json({ ok: true, actors: [] })); });
    expect(screen.queryByText(t('actorEmpty'))).toBeNull();
    page.unmount();
    expect(backend.mutate).not.toHaveBeenCalled();
  });

  it('replaces the locked Actor selector with login and loads choices after authorization', async () => {
    vi.useFakeTimers(); const backend = host({ egress: 'actor-own' }); const network = api();
    render(<ConfigPage ctx={backend.ctx} t={t} />); await tick(0);
    expect(screen.queryByRole('radiogroup', { name: t('actor') })).toBeNull();
    fireEvent.click(button('actorLoginAction')); await tick(0);
    expect(network.count('api/gtfa.apify-oauth-start')).toBe(1);
    network.setOAuth({ available: true, connected: true, pending: false }); await tick(2000);
    const choice = screen.getByRole('radio', { name: /actor-two/ }) as HTMLButtonElement;
    expect(choice.disabled).toBe(false);
    fireEvent.click(choice);
    expect(backend.saved().apifyActor).toBeUndefined();
    fireEvent.click(button('save')); await tick(0);
    expect(backend.saved().apifyActor).toBe('actor-two');
  });

  it('keeps edits local until Save, and Discard restores without writing', async () => {
    const backend = host(); const network = api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    expect(network.requests.filter(row => row.url !== 'api/gtfa.version')).toHaveLength(0);
    await chooseGeo(user, 'GB');
    expect(backend.saved().geo).toBe('US');
    expect(button('save').disabled).toBe(false);
    expect(button('testConnection').disabled).toBe(false);
    await user.click(button('discard'));
    expect((screen.getByRole('combobox', { name: t('geo') }) as HTMLInputElement).value).toBe(regionLabel('US', 'en'));
    expect(backend.mutate).not.toHaveBeenCalled();
    await chooseGeo(user, 'GB');
    await user.click(button('save'));
    await waitFor(() => expect(backend.saved().geo).toBe('GB'));
    expect(backend.mutate).toHaveBeenCalledTimes(1);
    expect(backend.mutate.mock.calls[0][1]).toBe(1);
    expect(button('save').disabled).toBe(true);
    await user.click(button('testConnection'));
    expect(network.count('api/gtfa.test-connection')).toBe(1);
  });

  it('preserves a rejected draft for retry and does not claim it was saved', async () => {
    const backend = host(); api(); const user = userEvent.setup();
    backend.mutate.mockResolvedValueOnce(false);
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    await chooseGeo(user, 'GB');
    await user.click(button('save'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', t('failed'));
    expect(backend.saved().geo).toBe('US');
    expect((screen.getByRole('combobox', { name: t('geo') }) as HTMLInputElement).value).toBe(regionLabel('GB', 'en'));
    expect(button('save').disabled).toBe(false);
    await user.click(button('save'));
    await waitFor(() => expect(backend.saved().geo).toBe('GB'));
  });

  it('validates a directory in Advanced before submitting it', async () => {
    const backend = host(); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    await user.click(screen.getByText(t('advanced'), { exact: true }));
    await user.click(screen.getByRole('tab', { name: t('advancedFiles') }));
    await user.clear(screen.getByRole('textbox', { name: t('snapshotDir') }));
    expect(button('save').disabled).toBe(true);
    expect(screen.getByText(t('requiredDirectory'))).toBeTruthy();
    expect(backend.mutate).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: t('snapshotDir') }), 'saved-research');
    await user.click(button('save'));
    await waitFor(() => expect(backend.saved().snapshotDir).toBe('saved-research'));
  });

  it('does not write a read-only Host configuration', async () => {
    const backend = host({}, false); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    expect((screen.getByRole('combobox', { name: t('geo') }) as HTMLInputElement).disabled).toBe(true);
    expect(button('save').disabled).toBe(true);
    await user.click(button('save'));
    expect(backend.mutate).not.toHaveBeenCalled();
    expect(backend.saved().geo).toBe('US');
  });
});

describe('connection diagnostic interactions', () => {
  it('tests an edited connection and Actor without saving, then clears the result on Discard', async () => {
    const backend = host(); const network = api(); const user = userEvent.setup();
    network.setOAuth({ available: true, connected: true, pending: false });
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    await user.click(screen.getByRole('tab', { name: t('egressOwn') }));
    await user.click(await screen.findByRole('radio', { name: /actor-two/ }));
    await user.click(button('testConnection'));
    expect(await screen.findByRole('heading', { name: t('diagnosticPassed') })).toBeTruthy();
    const request = network.requests.find(row => row.url === 'api/gtfa.test-connection')!;
    expect(JSON.parse(String(request.body))).toEqual({ egress: 'actor-own', apifyActor: 'actor-two' });
    expect(backend.saved().egress).toBe('local');
    expect(backend.saved().apifyActor).toBeUndefined();
    expect(backend.mutate).not.toHaveBeenCalled();
    expect(button('save').disabled).toBe(false);
    await user.click(button('discard'));
    expect(screen.getByRole('tab', { name: t('egressLocal') }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('heading', { name: t('diagnosticPassed') })).toBeNull();
    expect(backend.mutate).not.toHaveBeenCalled();
  });

  it('tests a newly typed manual token without persisting or displaying it in results', async () => {
    const backend = host({ egress: 'actor-own', apifyActor: 'actor-one' }); const network = api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    await user.click(await screen.findByRole('button', { name: t('actorManualAction') }));
    await user.type(screen.getByLabelText(t('token')), 'apify_api_draft_only');
    await user.click(button('testConnection'));
    expect(await screen.findByRole('heading', { name: t('diagnosticPassed') })).toBeTruthy();
    expect(JSON.parse(String(network.requests.find(row => row.url === 'api/gtfa.test-connection')!.body)))
      .toEqual({ egress: 'actor-own', apifyActor: 'actor-one', apifyToken: 'apify_api_draft_only' });
    expect(backend.mutate).not.toHaveBeenCalled();
    expect(backend.saved().apifyToken).toBeUndefined();
    expect(document.body.textContent).not.toContain('apify_api_draft_only');
  });

  it('shows real keyword counts only after a click and clears verification after edits', async () => {
    const backend = host(); const network = api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    expect(network.requests.filter(row => row.url !== 'api/gtfa.version')).toHaveLength(0);
    expect(screen.queryByText(t('connectionReady'))).toBeNull();
    await user.click(button('testConnection'));
    expect(await screen.findByText(t('connectionReady'))).toBeTruthy();
    expectKeywordCounts();
    expect(network.count('api/gtfa.test-connection')).toBe(1);
    await chooseGeo(user, 'GB');
    expect(screen.queryByText(t('connectionReady'))).toBeNull();
    expect(backend.mutate).not.toHaveBeenCalled();
  });

  it('does not display data verification for HTTP success with blocked, missing, or malformed data', async () => {
    const backend = host(); const network = api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    const blocked = diagnostic();
    network.fetch.mockResolvedValueOnce(Response.json({ ...blocked, ok: false, code: 'blocked', data: { ...blocked.data, ok: false, code: 'blocked',
      keywords: blocked.data.keywords.map(check => ({ ...check, status: 'error', points: 0, nonzeroPoints: 0 })) } }));
    await user.click(button('testConnection'));
    expect(await screen.findByText(t('testBlocked'))).toBeTruthy();
    expect(screen.getByText(t('connectionNetworkOnly'))).toBeTruthy();
    expect(screen.queryByText(t('connectionReady'))).toBeNull();
    network.fetch.mockResolvedValueOnce(Response.json({ ok: true, egress: 'local', status: 200, latencyMs: 1 }));
    await user.click(button('testConnection'));
    expect(await screen.findByText(t('testHostRestartRequired'))).toBeTruthy();
    expect(screen.getByRole('heading', { name: t('connectionHostRestart') })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Google Trends reachable (200, 1 ms)' })).toBeNull();
    expect(screen.queryByText(t('connectionReady'))).toBeNull();
    network.fetch.mockResolvedValueOnce(Response.json({ ...diagnostic(), data: { ...diagnostic().data, keywords: [] } }));
    await user.click(button('testConnection'));
    expect(await screen.findByText(t('testProtocol'))).toBeTruthy();
    expect(screen.queryByText(t('connectionReady'))).toBeNull();
    network.fetch.mockResolvedValueOnce(Response.json(diagnostic()));
    await user.click(button('testConnection'));
    expect(await screen.findByText(t('connectionReady'))).toBeTruthy();
    expect(screen.queryByText(t('testHostRestartRequired'))).toBeNull();
    expectKeywordCounts();
  });

  it.each(['local', 'actor-own'])('does not accept an older Host that checks saved %s settings instead of the draft', async egress => {
    const backend = host(); const network = api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    const { settingsSource: _source, ...oldHostResult } = diagnostic();
    network.fetch.mockResolvedValueOnce(Response.json({ ...oldHostResult, egress }));
    await user.click(button('testConnection'));
    expect(await screen.findByText(t('testHostRestartRequired'))).toBeTruthy();
    expect(screen.queryByText(t('connectionReady'))).toBeNull();
  });

  it('aborts the request when cancelled or unmounted and prevents duplicate clicks', async () => {
    const backend = host(); const network = api(); const user = userEvent.setup();
    let signal: AbortSignal | null | undefined;
    const pending = (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith('api/gtfa.version')) return Promise.resolve(new Response(null, { status: 404 }));
      return new Promise<Response>((_resolve, reject) => {
        signal = init?.signal;
        signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
      });
    };
    network.fetch.mockImplementation(pending);
    const page = render(<ConfigPage ctx={backend.ctx} t={t} />);
    await user.click(button('testConnection'));
    expect(button('testing').disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: t('geo') }) as HTMLInputElement).disabled).toBe(true);
    await user.click(button('testing'));
    expect(network.fetch.mock.calls.filter(([url]) => String(url) === 'api/gtfa.test-connection')).toHaveLength(1);
    await user.click(button('testCancel'));
    expect(await screen.findByText(t('testCancelled'))).toBeTruthy();
    expect(signal?.aborted).toBe(true);
    await user.click(button('testConnection'));
    page.unmount();
    expect(signal?.aborted).toBe(true);
    expect(backend.mutate).not.toHaveBeenCalled();
  });
});

describe('query-default pickers', () => {
  it('searches a region by code and commits a keyboard choice only after Save', async () => {
    const backend = host(); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    const input = screen.getByRole('combobox', { name: t('geo') }) as HTMLInputElement;
    await user.click(input);
    await user.type(input, 'gb');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option').id);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(input.value).toBe(regionLabel('GB', 'en'));
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(backend.saved().geo).toBe('US');
    expect(backend.mutate).not.toHaveBeenCalled();
    await user.click(button('save'));
    await waitFor(() => expect(backend.saved().geo).toBe('GB'));
  });

  it('searches Chinese names in English UI and preserves the empty Worldwide value', async () => {
    const backend = host(); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    const input = screen.getByRole('combobox', { name: t('geo') }) as HTMLInputElement;
    await user.click(input);
    await user.type(input, '美国');
    expect(screen.getByRole('option', { name: regionLabel('US', 'en') }).getAttribute('aria-selected')).toBe('true');
    await user.clear(input);
    await user.type(input, 'global');
    await user.click(screen.getByRole('option', { name: t('geoWorldwide') }));
    expect(input.value).toBe(t('geoWorldwide'));
    await user.click(button('save'));
    await waitFor(() => expect(backend.saved().geo).toBe(''));
  });

  it('shows anchor guidance and keeps a custom anchor until it is explicitly saved', async () => {
    const backend = host({ anchor: '', baselines: { version: 2, anchors: [
      { term: 'my research', geo: 'US', dailySearches: 1200, tolerance: 0.5 },
    ] } }); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    const input = screen.getByRole('combobox', { name: t('anchor') }) as HTMLInputElement;
    await user.click(input);
    expect(screen.getByText(t('anchorAutoOption'))).toBeTruthy();
    expect(screen.getByText(t('anchorRegionalOption'))).toBeTruthy();
    await user.type(input, 'my re');
    await user.click(within(screen.getByRole('listbox', { name: t('anchor') })).getByRole('option', { name: 'my research' }));
    expect(input.value).toBe('my research');
    expect(backend.saved().anchor).toBe('');
    await user.click(button('save'));
    await waitFor(() => expect(backend.saved().anchor).toBe('my research'));
  });

  it('dismisses unmatched searches with Escape, outside clicks and Tab without changing the draft', async () => {
    const backend = host(); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    const input = screen.getByRole('combobox', { name: t('geo') }) as HTMLInputElement;
    await user.click(input);
    await user.type(input, 'not-a-region');
    expect(screen.getByText(t('choiceEmpty'))).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(input.value).toBe(regionLabel('US', 'en'));
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(backend.mutate).not.toHaveBeenCalled();
    await user.keyboard('{Escape}jp');
    expect(screen.getByRole('option', { name: regionLabel('JP', 'en') })).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.click(input);
    await user.click(screen.getByRole('heading', { name: t('defaults') }));
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(screen.getByRole('combobox', { name: t('anchor') }));
    await user.tab();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(backend.mutate).not.toHaveBeenCalled();
    expect(button('save').disabled).toBe(true);
  });
});

describe('baseline editor', () => {
  const pick = async (user: ReturnType<typeof userEvent.setup>, label: string, option: string | RegExp) => {
    await user.click(screen.getByRole('combobox', { name: label }));
    await user.click(within(screen.getByRole('listbox', { name: label })).getByRole('option', { name: option }));
  };
  const sampleBaselines = () => ({ anchors: [
    { term: 'research', geo: 'US', dailySearches: 1200, tolerance: 0.2 },
  ], windowAnchors: { short: 'research', long: 'sudoku' } });

  it('shows all built-ins alongside existing US rows and preserves edits while browsing', async () => {
    const anchors = [
      { term: 'gpts', geo: 'US', dailySearches: 3500, tolerance: 0.5 },
      { term: 'sudoku', geo: 'US', dailySearches: 63000, tolerance: 0.5 },
    ];
    const backend = host({ baselines: { anchors } }); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} initialAdvancedOpen />);
    const catalog = within(screen.getByRole('region', { name: t('baselineBuiltin') }));
    const table = () => within(catalog.getByRole('table'));
    expect(table().getAllByRole('row')).toHaveLength(60);
    for (const geo of ['CA', 'GB', 'DE', 'FR', 'JP']) {
      expect(table().getAllByRole('rowheader', { name: regionLabel(geo, 'en') }).length).toBeGreaterThan(0);
    }
    for (const geo of ['AU', 'IN']) {
      expect(table().queryByRole('rowheader', { name: regionLabel(geo, 'en') })).toBeNull();
    }
    expect(table().getAllByText('30d+')).toHaveLength(3);
    expect(table().getAllByRole('rowheader', { name: t('geoWorldwide') })).toHaveLength(10);
    const daily = screen.getByRole('spinbutton', { name: `${t('anchorDaily')} sudoku` });
    await user.clear(daily); await user.type(daily, '50000');
    await user.type(screen.getByRole('textbox', { name: t('newAnchorTerm') }), 'research');
    await user.type(screen.getByRole('spinbutton', { name: `${t('anchorDaily')} ${t('newAnchorTerm')}` }), '1200');
    await pick(user, t('baselineBrowseGeo'), t('geoWorldwide'));
    expect(table().getAllByRole('row')).toHaveLength(11);
    expect(table().getByText('440,000')).toBeTruthy();
    await pick(user, t('baselineBrowseGeo'), regionLabel('JP', 'en'));
    expect(table().getAllByRole('row')).toHaveLength(9);
    expect(table().getByText('テトリス')).toBeTruthy();
    expect((daily as HTMLInputElement).value).toBe('50000');
    expect((screen.getByRole('combobox', { name: t('geo') }) as HTMLInputElement).value).toBe(regionLabel('US', 'en'));
    expect(backend.saved().baselines).toEqual({ anchors });
    expect(backend.mutate).not.toHaveBeenCalled();
    await user.click(button('save'));
    await waitFor(() => expect(backend.saved().baselines).toEqual({ anchors: [
      anchors[0], { ...anchors[1], dailySearches: 50000 },
      { term: 'research', geo: 'US', dailySearches: 1200, tolerance: 0.5 },
    ] }));
  });

  it('allows read-only catalog browsing with custom baselines off without writing configuration', async () => {
    const backend = host({}, false); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} initialAdvancedOpen />);
    const catalog = within(screen.getByRole('region', { name: t('baselineBuiltin') }));
    expect(catalog.getAllByRole('row')).toHaveLength(60);
    await pick(user, t('baselineBrowseGeo'), regionLabel('CA', 'en'));
    expect(catalog.getAllByRole('row')).toHaveLength(8);
    expect(catalog.getByText('15,000')).toBeTruthy();
    expect(screen.queryByRole('spinbutton', { name: `${t('anchorDaily')} gpts` })).toBeNull();
    expect(button('save').disabled).toBe(true);
    expect(backend.saved().baselines).toBeUndefined();
    expect(backend.mutate).not.toHaveBeenCalled();
  });

  it('syncs MEKA baselines manually on click and updates status without touching saved config', async () => {
    const backend = host(); const network = api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} initialAdvancedOpen />);
    await waitFor(() => expect(network.count('api/gtfa.baselines')).toBe(1));
    await user.click(button('baselineSync'));
    expect(await screen.findByText('Updated to MEKA baselines 2026-11-20 (59 anchors).')).toBeTruthy();
    expect(screen.getByText('Synced · 2026-11-20')).toBeTruthy();
    expect(network.count('api/gtfa.baselines-sync')).toBe(1);
    expect(backend.mutate).not.toHaveBeenCalled();
  });

  it('seeds editable regional baselines and preserves explicit regions on Save', async () => {
    const backend = host({ geo: 'JP' }); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} initialAdvancedOpen />);
    await user.click(screen.getByRole('switch', { name: t('overrideBaselines') }));
    expect((screen.getByRole('spinbutton', { name: `${t('anchorDaily')} テトリス` }) as HTMLInputElement).value).toBe('18000');
    await user.click(button('save'));
    await waitFor(() => expect(backend.saved().baselines).toEqual({ anchors: [
      { term: 'テトリス', geo: 'JP', dailySearches: 18000, tolerance: 0.5 },
    ] }));
  });

  it('edits region, daily searches, tolerance and windows without writing until Save', async () => {
    const backend = host(); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} initialAdvancedOpen />);
    const toggle = screen.getByRole('switch', { name: t('overrideBaselines') });
    await user.click(toggle);
    expect((screen.getByRole('spinbutton', { name: `${t('anchorDaily')} sudoku` }) as HTMLInputElement).value).toBe('88000');
    const geo = screen.getByRole('combobox', { name: `${t('anchorGeo')} sudoku` });
    await user.click(geo);
    expect(screen.getByRole('option', { name: t('geoWorldwide') })).toBeTruthy();
    await user.type(geo, 'gb');
    await user.click(screen.getByRole('option', { name: regionLabel('GB', 'en') }));
    const daily = screen.getByRole('spinbutton', { name: `${t('anchorDaily')} sudoku` });
    await user.clear(daily); await user.type(daily, '4200');
    const tolerance = screen.getByRole('combobox', { name: `${t('anchorTolerance')} sudoku` }) as HTMLInputElement;
    await user.click(tolerance);
    expect(tolerance.readOnly).toBe(true);
    await user.keyboard('{ArrowUp}{Enter}');
    expect(tolerance.value).toBe('±25%');
    await pick(user, t('windowShort'), /^sudoku/);
    await user.click(toggle); await user.click(toggle);
    expect((screen.getByRole('spinbutton', { name: `${t('anchorDaily')} sudoku` }) as HTMLInputElement).value).toBe('4200');
    expect((screen.getByRole('combobox', { name: t('windowLong') }) as HTMLInputElement).value).toBe(`${t('windowDefault')} · sudoku`);
    expect(backend.saved().baselines).toBeUndefined();
    expect(backend.mutate).not.toHaveBeenCalled();
    await user.click(button('save'));
    await waitFor(() => expect(backend.saved().baselines).toEqual({ anchors: [
      { term: 'sudoku', geo: 'GB', dailySearches: 4200, tolerance: 0.25 },
    ], windowAnchors: { short: 'sudoku' } }));
  });

  it('adds and removes anchors, preserves custom tolerance and saves a pending new row', async () => {
    const backend = host({ baselines: sampleBaselines() }); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} initialAdvancedOpen />);
    await user.click(screen.getByRole('combobox', { name: `${t('anchorTolerance')} research` }));
    expect(screen.getByRole('option', { name: '±20%' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('option', { name: '±10%' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '±100%' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.type(screen.getByRole('textbox', { name: t('newAnchorTerm') }), 'chairs');
    await user.type(screen.getByRole('spinbutton', { name: `${t('anchorDaily')} ${t('newAnchorTerm')}` }), '9000');
    await pick(user, `${t('anchorGeo')} ${t('newAnchorTerm')}`, regionLabel('GB', 'en'));
    await pick(user, `${t('anchorTolerance')} ${t('newAnchorTerm')}`, '±10%');
    await user.click(button('addAnchor'));
    expect(screen.getByRole('spinbutton', { name: `${t('anchorDaily')} chairs` })).toBeTruthy();
    await pick(user, t('windowLong'), 'chairs');
    await user.click(screen.getByRole('button', { name: `${t('remove')} research` }));
    expect(button('save').disabled).toBe(true); // The short window still references the removed anchor.
    await pick(user, t('windowShort'), `${t('windowDefault')} · sudoku`);
    await user.type(screen.getByRole('textbox', { name: t('newAnchorTerm') }), 'puzzle');
    await user.type(screen.getByRole('spinbutton', { name: `${t('anchorDaily')} ${t('newAnchorTerm')}` }), '500');
    expect(backend.mutate).not.toHaveBeenCalled();
    await user.click(button('save'));
    await waitFor(() => expect(backend.saved().baselines).toEqual({ anchors: [
      { term: 'chairs', geo: 'GB', dailySearches: 9000, tolerance: 0.1 },
      { term: 'puzzle', geo: 'US', dailySearches: 500, tolerance: 0.5 },
    ], windowAnchors: { long: 'chairs' } }));
  });

  it('blocks duplicate anchors and invalid daily searches, then saves the original custom tolerance', async () => {
    const backend = host({ baselines: sampleBaselines() }); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} initialAdvancedOpen />);
    const term = screen.getByRole('textbox', { name: t('newAnchorTerm') });
    const newDaily = screen.getByRole('spinbutton', { name: `${t('anchorDaily')} ${t('newAnchorTerm')}` });
    await user.type(term, ' RESEARCH '); await user.type(newDaily, '100');
    expect(screen.getByText(t('duplicateAnchor'))).toBeTruthy();
    expect(button('addAnchor').disabled).toBe(true); expect(button('save').disabled).toBe(true);
    await user.clear(term); await user.clear(newDaily);
    const daily = screen.getByRole('spinbutton', { name: `${t('anchorDaily')} research` });
    for (const invalid of ['0', '-1']) {
      await user.clear(daily); await user.type(daily, invalid);
      expect(daily.getAttribute('aria-invalid')).toBe('true'); expect(button('save').disabled).toBe(true);
    }
    expect(backend.mutate).not.toHaveBeenCalled();
    await user.clear(daily); await user.type(daily, '1500');
    await user.click(button('save'));
    await waitFor(() => expect(backend.saved().baselines).toEqual({ ...sampleBaselines(), anchors: [
      { term: 'research', geo: 'US', dailySearches: 1500, tolerance: 0.2 },
    ] }));
  });

  it('keeps the editor read-only when Host configuration is not writable', async () => {
    const backend = host({ baselines: sampleBaselines() }, false); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} initialAdvancedOpen />);
    for (const name of [`${t('anchorGeo')} research`, `${t('anchorTolerance')} research`, t('windowShort'), t('windowLong')]) {
      const picker = screen.getByRole('combobox', { name }) as HTMLInputElement;
      expect(picker.disabled).toBe(true); await user.click(picker);
    }
    expect(screen.queryByRole('listbox')).toBeNull();
    expect((screen.getByRole('switch', { name: t('overrideBaselines') }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: `${t('remove')} research` }) as HTMLButtonElement).disabled).toBe(true);
    expect(backend.mutate).not.toHaveBeenCalled();
  });
});

describe('Actor creation and selection', () => {
  it.each([null, { version: '0.2.22', baselineCatalogRevision: '2026-11-19' }, { version: '0.2.23', baselineCatalogRevision: '2026-11-19' }])('separates actual runtime version from successful keyword checks: %j', runtime => {
    const base = diagnostic();
    render(<ConnectionTestResults result={{ ...base, egress: 'actor-own', network: { ...base.network, egress: 'actor-own' },
      data: { ...base.data, keywords: base.data.keywords.map(item => ({ ...item, status: 'ok' as const })) },
      actorRuntime: runtime, pluginVersion: '0.2.23' }} t={t} locale="en" />);
    expect(screen.getByText(t('diagnosticPassed'))).toBeTruthy();
    expect(screen.getByText(runtime === null ? t('actorRuntimeUnknown') : runtime.version === '0.2.23'
      ? 'Actor v0.2.23 · Plugin v0.2.23' : 'Actor v0.2.22 is behind Plugin v0.2.23 — update your selected Actor.')).toBeTruthy();
  });
  it('updates the unsaved selected Actor and watches the returned build without saving configuration', async () => {
    const backend = host({ egress: 'actor-own', apifyActor: 'actor-one' });
    const network = api(); const user = userEvent.setup();
    network.setOAuth({ available: true, connected: true, pending: false });
    const original = network.fetch.getMockImplementation()!;
    network.fetch.mockImplementation((url, init) => String(url) === 'api/gtfa.apify-update'
      ? Promise.resolve(Response.json({ ok: true, actorId: 'actor-two', buildId: 'updating-build' })) : original(url, init));
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    await user.click(await screen.findByRole('radio', { name: /actor-two/ }));
    await user.click(button('actorUpdate'));
    expect(await screen.findByText(t('actorUpdatingTitle'))).toBeTruthy();
    const call = network.fetch.mock.calls.find(([url]) => String(url) === 'api/gtfa.apify-update')!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ apifyActor: 'actor-two' });
    expect(button('save').disabled).toBe(true);
    expect(backend.saved().apifyActor).toBe('actor-one');
    expect(backend.mutate).not.toHaveBeenCalled();
  });
  function deployment() {
    const backend = host({ egress: 'actor-own', apifyActor: 'previous-account-actor' });
    const network = api();
    network.setOAuth({ available: true, connected: true, pending: false });
    const original = network.fetch.getMockImplementation()!;
    let actors: ReturnType<typeof actorRow>[] = [];
    let resolveDeploy: (response: Response) => void = () => {};
    let signal: AbortSignal | null | undefined;
    const deployRequest = vi.fn((init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>(resolve => { resolveDeploy = resolve; });
    });
    network.fetch.mockImplementation((url, init) => String(url).startsWith('api/gtfa.apify-actors')
      ? Promise.resolve(Response.json({ ok: true, actors }))
      : String(url) === 'api/gtfa.apify-deploy' ? deployRequest(init) : original(url, init));
    return { backend, network, deployRequest, signal: () => signal,
      setBuild: (status: string) => { actors = [actorRow('unrelated', 'SUCCEEDED', 'other-build'), actorRow('new-actor', status, 'new-build')]; },
      finish: (result: Record<string, unknown> = { ok: true, actorId: 'new-actor', buildId: 'new-build' }) => resolveDeploy(Response.json(result)),
    };
  }

  it('shows creation and building instead of a stale Actor warning, then selects only the completed build', async () => {
    vi.useFakeTimers(); const flow = deployment();
    render(<ConfigPage ctx={flow.backend.ctx} t={t} />); await tick(0);
    fireEvent.click(button('deploy')); await tick(0);
    expect(screen.getByText(t('actorCreatingTitle'))).toBeTruthy();
    expect(screen.queryByText(t('actorMissing'))).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(button('testConnection').disabled).toBe(true);
    expect(button('save').disabled).toBe(true);
    expect(flow.deployRequest).toHaveBeenCalledTimes(1);

    flow.setBuild('RUNNING'); flow.finish(); await tick(0);
    expect(screen.getByText(t('actorBuildingTitle'))).toBeTruthy();
    expect(screen.queryByText(t('actorMissing'))).toBeNull();
    expect(screen.queryByText(t('actorNotBuilt'))).toBeNull();
    flow.setBuild('SUCCEEDED'); await tick(15_000);
    expect(screen.queryByText(t('actorBuildingTitle'))).toBeNull();
    expect(screen.getByRole('radio', { name: /new-actor/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /unrelated/ }).getAttribute('aria-checked')).toBe('false');
    expect(flow.backend.saved().apifyActor).toBe('previous-account-actor');
    expect(flow.backend.mutate).not.toHaveBeenCalled();
    fireEvent.click(button('save')); await tick(0);
    expect(flow.backend.saved().apifyActor).toBe('new-actor');
  });

  it('reports a failed build without claiming it is ready or selecting it', async () => {
    vi.useFakeTimers(); const flow = deployment();
    render(<ConfigPage ctx={flow.backend.ctx} t={t} />); await tick(0);
    fireEvent.click(button('deploy')); await tick(0);
    flow.setBuild('FAILED'); flow.finish(); await tick(0);
    expect(screen.getByText(t('deployBuildFailed')).getAttribute('role')).toBe('alert');
    const failed = screen.getByRole('radio', { name: /new-actor/ });
    expect(failed.getAttribute('aria-checked')).toBe('false');
    expect(within(failed).getByText(t('actorBuildFailed'))).toBeTruthy();
    expect(within(failed).queryByText(t('actorReady'))).toBeNull();
    expect(flow.backend.mutate).not.toHaveBeenCalled();
  });

  it('ignores a late deployment after switching routes and stops watching its build', async () => {
    vi.useFakeTimers(); const flow = deployment();
    render(<ConfigPage ctx={flow.backend.ctx} t={t} />); await tick(0);
    fireEvent.click(button('deploy')); await tick(0);
    fireEvent.click(screen.getByRole('tab', { name: t('egressPublic') })); await tick(0);
    expect(flow.signal()?.aborted).toBe(true);
    flow.setBuild('SUCCEEDED'); flow.finish(); await tick(0);
    expect(screen.queryByText(t('actorBuildingTitle'))).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: t('egressOwn') })); await tick(0);
    expect(screen.getByRole('radio', { name: /new-actor/ }).getAttribute('aria-checked')).toBe('false');
    expect(flow.backend.saved().apifyActor).toBe('previous-account-actor');
    expect(flow.backend.mutate).not.toHaveBeenCalled();
  });
});

describe('OAuth page lifecycle', () => {
  it('starts only after a click, cancels pending login, and stops polling after cancel', async () => {
    vi.useFakeTimers(); const backend = host({ egress: 'actor-public' }); const network = api();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    await tick(0);
    expect(network.count('api/gtfa.apify-oauth-start')).toBe(0);
    fireEvent.click(button('oauthSignIn')); await tick(0);
    expect(screen.getByText(/TEST-ONLY/)).toBeTruthy();
    expect((screen.getByRole('link', { name: t('oauthOpen') }) as HTMLAnchorElement).href)
      .toBe('https://console.apify.com/authorize/device');
    await tick(2000);
    expect(network.count('api/gtfa.apify-oauth')).toBe(2);
    fireEvent.click(button('oauthCancel')); await tick(0);
    expect(network.count('api/gtfa.apify-oauth-cancel')).toBe(1);
    const count = network.requests.length;
    await tick(10_000);
    expect(network.requests).toHaveLength(count);
    expect(button('oauthSignIn')).toBeTruthy();
    expect(backend.mutate).not.toHaveBeenCalled();
  });

  it('aborts a pending status read on unmount and resumes the Host login on reopening', async () => {
    vi.useFakeTimers(); const backend = host({ egress: 'actor-public' }); const network = api();
    network.setOAuth({ available: true, connected: false, pending: true, userCode: 'TEST-ONLY' });
    const page = render(<ConfigPage ctx={backend.ctx} t={t} />);
    await tick(0);
    page.unmount();
    expect(network.requests.find(row => row.url === 'api/gtfa.apify-oauth')?.signal?.aborted).toBe(true);
    expect(backend.subscribers()).toBe(0);
    const count = network.requests.length;
    await tick(10_000);
    expect(network.requests).toHaveLength(count);
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    await tick(0);
    expect(screen.getByText(/TEST-ONLY/)).toBeTruthy();
    expect(network.count('api/gtfa.apify-oauth-start')).toBe(0);
    network.setOAuth({ available: true, connected: true, pending: false });
    await tick(2000);
    expect(screen.getByText(t('oauthConnected'), { exact: true })).toBeTruthy();
    const polls = network.count('api/gtfa.apify-oauth');
    await tick(10_000);
    expect(network.count('api/gtfa.apify-oauth')).toBe(polls);
    expect(backend.mutate).not.toHaveBeenCalled();
  });

  it('drops polling when switching to local egress and signs out through the Host', async () => {
    vi.useFakeTimers(); const backend = host({ egress: 'actor-public' }); const network = api();
    network.setOAuth({ available: true, connected: true, pending: false });
    render(<ConfigPage ctx={backend.ctx} t={t} />); await tick(0);
    fireEvent.click(screen.getByLabelText(t('accountActions')));
    fireEvent.click(button('oauthLogout')); await tick(0);
    expect(network.count('api/gtfa.apify-oauth-logout')).toBe(1);
    expect(button('oauthSignIn')).toBeTruthy();
    network.setOAuth({ available: true, connected: false, pending: true });
    fireEvent.click(button('oauthSignIn')); await tick(0);
    fireEvent.click(screen.getByRole('tab', { name: t('egressLocal') })); await tick(0);
    const count = network.requests.length;
    await tick(10_000);
    expect(network.requests).toHaveLength(count);
    expect(backend.saved().egress).toBe('actor-public');
    expect(backend.mutate).not.toHaveBeenCalled();
  });

  it('shows Test cost on ConnectionTestResults for Actor runs when costUsd is returned and omits it for local runs', () => {
    const raw = diagnostic();
    const base = {
      ...raw,
      data: { ...raw.data, keywords: raw.data.keywords.map(item => ({ ...item, status: 'ok' as const })) },
    };
    const { rerender } = render(
      <ConnectionTestResults
        result={{
          ...base,
          egress: 'actor-own',
          network: { ...base.network, egress: 'actor-own' },
          actorRunId: 'run-probe-1',
          costUsd: 0.00004,
        }}
        t={t}
        locale="en"
      />,
    );
    expect(screen.getByText(t('diagnosticCost'))).toBeTruthy();
    expect(screen.getByText('<$0.0001')).toBeTruthy();

    rerender(
      <ConnectionTestResults
        result={{ ...base, egress: 'local', network: { ...base.network, egress: 'local' } }}
        t={t}
        locale="en"
      />,
    );
    expect(screen.queryByText(t('diagnosticCost'))).toBeNull();
  });
});
