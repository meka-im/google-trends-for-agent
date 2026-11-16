// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigPage, EN, type ConfigPageProps } from '../src/client/index.js';
import { CONNECTION_FILTER, CONNECTION_KEYWORDS } from '../src/connection-check.js';

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
const expectKeywordCounts = () => {
  for (const keyword of CONNECTION_KEYWORDS) {
    const row = screen.getByRole('rowheader', { name: keyword }).closest('tr')!;
    expect(within(row).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['12', '10', t('diagnosticPass')]);
  }
};
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('settings interactions', () => {
  it('dismisses the account menu on outside clicks, focus changes, and Escape without signing out', async () => {
    const backend = host({ egress: 'actor-public' }); const network = api(); const user = userEvent.setup();
    network.setOAuth({ available: true, connected: true, pending: false });
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    const trigger = await screen.findByLabelText(t('accountActions'));
    const menu = trigger.closest('details')!;
    await user.click(trigger);
    expect(menu.open).toBe(true);
    await user.click(screen.getByRole('heading', { name: t('connection') }));
    expect(menu.open).toBe(false);
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(menu.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.tab();
    expect(document.activeElement).toBe(button('oauthLogout'));
    await user.tab();
    expect(menu.open).toBe(false);
    expect(network.count('api/gtfa.apify-oauth-logout')).toBe(0);
    expect(backend.mutate).not.toHaveBeenCalled();
  });

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
    await user.click(screen.getByRole('tab', { name: t('egressOwn') }));
    await waitFor(() => expect(pending.at(-1)!.signal?.aborted).toBe(false));
    const last = pending.at(-1)!;
    page.unmount();
    expect(last.signal?.aborted).toBe(true);
    last.resolve(Response.json({ ok: true, actors: [] }));
    expect(backend.mutate).not.toHaveBeenCalled();
  });

  it('replaces the locked Actor selector with login and loads choices after authorization', async () => {
    vi.useFakeTimers(); const backend = host({ egress: 'actor-own' }); const network = api();
    render(<ConfigPage ctx={backend.ctx} t={t} />); await tick(0);
    expect(screen.queryByRole('radiogroup', { name: t('actor') })).toBeNull();
    expect(screen.getByText(t('actorLoginRequired'))).toBeTruthy();
    fireEvent.click(button('actorLoginAction')); await tick(0);
    expect(network.count('api/gtfa.apify-oauth-start')).toBe(1);
    expect(screen.getByText(t('actorLoginPending'))).toBeTruthy();
    network.setOAuth({ available: true, connected: true, pending: false }); await tick(2000);
    const choice = screen.getByRole('radio', { name: /actor-two/ }) as HTMLButtonElement;
    expect(choice.disabled).toBe(false);
    fireEvent.click(choice);
    expect(backend.saved().apifyActor).toBeUndefined();
    fireEvent.click(button('save')); await tick(0);
    expect(backend.saved().apifyActor).toBe('actor-two');
  });

  it('opens and focuses the manual token fallback instead of leaving a disabled Actor field', async () => {
    const backend = host({ egress: 'actor-own' }); api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    await user.click(await screen.findByRole('button', { name: t('actorManualAction') }));
    const input = screen.getByLabelText(t('token'));
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(backend.mutate).not.toHaveBeenCalled();
  });

  it('retries a failed Actor list and restores an interactive selector', async () => {
    const backend = host({ egress: 'actor-own' }); const network = api(); const user = userEvent.setup();
    network.setOAuth({ available: true, connected: true, pending: false }); network.failActors(true);
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    await screen.findByRole('button', { name: t('actorListRetry') });
    expect(screen.queryByRole('radiogroup', { name: t('actor') })).toBeNull();
    network.failActors(false); await user.click(button('actorListRetry'));
    expect((await screen.findByRole('radio', { name: /actor-one/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(backend.mutate).not.toHaveBeenCalled();
  });

  it('keeps edits local until Save, and Discard restores without writing', async () => {
    const backend = host(); const network = api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    expect(network.requests).toHaveLength(0);
    await user.selectOptions(screen.getByRole('combobox', { name: t('geo') }), 'GB');
    expect(backend.saved().geo).toBe('US');
    expect(button('save').disabled).toBe(false);
    expect(button('testConnection').disabled).toBe(false);
    await user.click(button('discard'));
    expect((screen.getByRole('combobox', { name: t('geo') }) as HTMLSelectElement).value).toBe('US');
    expect(backend.mutate).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByRole('combobox', { name: t('geo') }), 'GB');
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
    await user.selectOptions(screen.getByRole('combobox', { name: t('geo') }), 'GB');
    await user.click(button('save'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', t('failed'));
    expect(backend.saved().geo).toBe('US');
    expect((screen.getByRole('combobox', { name: t('geo') }) as HTMLSelectElement).value).toBe('GB');
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
    expect((screen.getByRole('combobox', { name: t('geo') }) as HTMLSelectElement).disabled).toBe(true);
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
    expect(network.requests).toHaveLength(0);
    expect(screen.queryByText(t('connectionReady'))).toBeNull();
    await user.click(button('testConnection'));
    expect(await screen.findByText(t('connectionReady'))).toBeTruthy();
    expectKeywordCounts();
    expect(network.count('api/gtfa.test-connection')).toBe(1);
    await user.selectOptions(screen.getByRole('combobox', { name: t('geo') }), 'GB');
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
    const pending = (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      signal = init?.signal;
      signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    });
    network.fetch.mockImplementation(pending);
    const page = render(<ConfigPage ctx={backend.ctx} t={t} />);
    await user.click(button('testConnection'));
    expect(button('testing').disabled).toBe(true);
    expect((screen.getByRole('combobox', { name: t('geo') }) as HTMLSelectElement).disabled).toBe(true);
    await user.click(button('testing'));
    expect(network.fetch).toHaveBeenCalledTimes(1);
    await user.click(button('testCancel'));
    expect(await screen.findByText(t('testCancelled'))).toBeTruthy();
    expect(signal?.aborted).toBe(true);
    await user.click(button('testConnection'));
    page.unmount();
    expect(signal?.aborted).toBe(true);
    expect(backend.mutate).not.toHaveBeenCalled();
  });
});

describe('Actor creation and selection', () => {
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

  it('keeps a keyboard selection visible during refresh without saving it', async () => {
    const backend = host({ egress: 'actor-own', apifyActor: 'actor-one' });
    const network = api(); const user = userEvent.setup();
    network.setOAuth({ available: true, connected: true, pending: false });
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    const first = await screen.findByRole('radio', { name: /actor-one/ });
    first.focus(); await user.keyboard('{ArrowDown}');
    const second = screen.getByRole('radio', { name: /actor-two/ });
    expect(second.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(second);
    const original = network.fetch.getMockImplementation()!;
    let finish: (response: Response) => void = () => {};
    network.fetch.mockImplementation((url, init) => String(url).startsWith('api/gtfa.apify-actors')
      ? new Promise(resolve => { finish = resolve; }) : original(url, init));
    await user.click(button('actorRefreshLabel'));
    expect(screen.getByRole('radio', { name: /actor-two/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radiogroup').getAttribute('aria-busy')).toBe('true');
    await act(async () => { finish(Response.json({ ok: true, actors: [actorRow('actor-one'), actorRow('actor-two')] })); });
    expect(screen.getByRole('radiogroup').getAttribute('aria-busy')).toBe('false');
    expect(backend.mutate).not.toHaveBeenCalled();
    expect(backend.saved().apifyActor).toBe('actor-one');
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
});
