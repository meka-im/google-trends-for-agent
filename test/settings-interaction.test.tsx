// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  const requests: Array<{ url: string; method: string; signal?: AbortSignal | null }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    requests.push({ url: path, method: init?.method ?? 'GET', signal: init?.signal });
    if (path === 'api/gtfa.apify-oauth-start') oauth = { available: true, connected: false, pending: true,
      userCode: 'TEST-ONLY', verificationUri: 'https://console.apify.com/authorize/device',
      expiresAt: '2099-01-01T00:00:00.000Z' };
    if (path === 'api/gtfa.apify-oauth-cancel' || path === 'api/gtfa.apify-oauth-logout') {
      oauth = { available: true, connected: false, pending: false };
    }
    if (path.startsWith('api/gtfa.apify-oauth')) return Response.json(oauth);
    if (path.startsWith('api/gtfa.apify-usage')) return Response.json({ ok: false, code: 'no-token' });
    if (path === 'api/gtfa.test-connection') return Response.json(diagnostic());
    throw new Error(`Unexpected request in interaction test: ${path}`);
  });
  vi.stubGlobal('fetch', fetch);
  return { requests, fetch, setOAuth: (value: Record<string, unknown>) => { oauth = value; },
    count: (path: string) => requests.filter(row => row.url === path).length };
}

function diagnostic() {
  return { ok: true, egress: 'local', status: 200, latencyMs: 4, checkedAt: '2026-11-16T00:00:00.000Z',
    network: { ok: true, egress: 'local', status: 200, latencyMs: 1 },
    data: { ok: true, latencyMs: 3, ...CONNECTION_FILTER,
      keywords: CONNECTION_KEYWORDS.map(keyword => ({ keyword, status: 'ok', points: 12, nonzeroPoints: 10 })) } };
}

const button = (key: string) => screen.getByRole('button', { name: t(key) }) as HTMLButtonElement;
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('settings interactions', () => {
  it('keeps edits local until Save, and Discard restores without writing', async () => {
    const backend = host(); const network = api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    expect(network.requests).toHaveLength(0);
    await user.selectOptions(screen.getByRole('combobox', { name: t('geo') }), 'GB');
    expect(backend.saved().geo).toBe('US');
    expect(button('save').disabled).toBe(false);
    expect(button('testSaveFirst').disabled).toBe(true);
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
  it('shows real keyword counts only after a click and clears verification after edits', async () => {
    const backend = host(); const network = api(); const user = userEvent.setup();
    render(<ConfigPage ctx={backend.ctx} t={t} />);
    expect(network.requests).toHaveLength(0);
    expect(screen.queryByText(t('connectionReady'))).toBeNull();
    await user.click(button('testConnection'));
    expect(await screen.findByText(t('connectionReady'))).toBeTruthy();
    expect(screen.getAllByText('12 points · 10 nonzero')).toHaveLength(3);
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
    expect(await screen.findByText(t('testIncomplete'))).toBeTruthy();
    expect(screen.queryByText(t('connectionReady'))).toBeNull();
    network.fetch.mockResolvedValueOnce(Response.json({ ...diagnostic(), data: { ...diagnostic().data, keywords: [] } }));
    await user.click(button('testConnection'));
    expect(await screen.findByText(t('testProtocol'))).toBeTruthy();
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
