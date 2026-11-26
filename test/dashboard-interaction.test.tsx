// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard, resultSeries } from '../src/client/dashboard.js';
import { TrendChart } from '../src/client/trend-chart.js';
import { DashboardController } from '../src/client/dashboard-state.js';
import { DASHBOARD_EN, DASHBOARD_ZH } from '../src/client/dashboard-locale.js';
import { DASHBOARD_CSS } from '../src/client/dashboard-theme.js';
import type { ActorRunRecord, QueryRecord, SavedQuery } from '../src/query-history-types.js';

const t = (key: string) => DASHBOARD_EN[key] ?? key;
const times = ['now 1-H', 'now 4-H', 'now 1-d', 'now 7-d', 'today 1-m', 'today 3-m', 'today 12-m', 'today 5-y', 'all'];
const controllers: DashboardController[] = [];
beforeEach(() => {
  sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); controllers.splice(0).forEach(controller => controller.dispose()); vi.restoreAllMocks(); });
function api(delay?: Promise<void>, customRuns?: ActorRunRecord[]) {
  let rows: QueryRecord[] = []; const results = new Map<string, SavedQuery>();
  let ledger: ActorRunRecord[] = [...(customRuns ?? [])];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.includes('?progress=')) return Response.json({ ok: true, progress: { requestId: url.split('?progress=')[1], phase: 'running', startedAt: Date.now() - 3000 } });
    if (body?.action === 'clear') { rows = rows.filter(row => !body.ids.includes(row.id)); return Response.json({ ok: true }); }
    if (body?.action === 'reconcileRuns') {
      ledger = ledger.map(run => run.costUsd === null ? { ...run, costUsd: 0.00015 } : run);
      return Response.json({ ok: true, updated: 1, remaining: 0, actorRuns: ledger });
    }
    if (body?.action === 'batch') {
      const saved = results.get(body.id)!;
      const batchVolume = {
        complete: true,
        rounds: [{ round: 1, anchor: 'sudoku', daily: 88000, targets: saved.record.terms }],
        runs: [],
        series: saved.record.terms.map(keyword => ({
          keyword,
          anchor: { term: 'sudoku', dailySearches: 88000 },
          traffic: { average: 12000, latest: 11000, settledLatest: 11000, peak: 15000 },
          points: [{ t: '2026-01-01', value: 10000 }, { t: '2026-11-01', value: 14000 }],
        })),
      };
      const updated: SavedQuery = { record: { ...saved.record, dailyVolume: 12000 }, result: { ...saved.result, batchVolume } };
      rows = rows.map(row => row.id === body.id ? updated.record : row);
      results.set(body.id, updated);
      return Response.json({ ok: true, saved: updated });
    }
    if (body?.action === 'query') {
      await delay;
      const id = `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`;
      const record: QueryRecord = { id, tool: body.name, terms: body.input.keywords ?? [body.input.term], geo: body.input.geo, time: body.input.time, source: 'manual', egress: 'actor-public', status: 'ok', cached: false,
        createdAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), durationMs: 3100, actorRunId: `run-${id}`, costUsd: 0.00025, errorCode: null };
      const series = record.terms.map(term => ({ keyword: term, average: 25, latest: 30, peak: 30, points: [{ t: '2026-01-01', value: 20 }, { t: '2026-11-01', value: 30 }] }));
      const result = { ok: true, status: 'ok', onDemand: true, series, filter: { geo: record.geo, time: record.time }, meta: { queryRecordId: id } };
      ledger.unshift({
        runId: `run-${id}`, actorId: 'meka.im~google-trends-for-agent', egress: 'actor-public', purpose: 'query',
        source: 'manual', tool: body.name, terms: record.terms, geo: record.geo, time: record.time,
        status: 'SUCCEEDED', toolStatus: 'ok', startedAt: record.createdAt, finishedAt: record.createdAt,
        durationMs: 3100, costUsd: 0.00025, queryRecordId: id,
      });
      rows.unshift(record); results.set(id, { record, result, actorRuns: ledger.filter(r => r.queryRecordId === id) }); return Response.json({ ok: true, result });
    }
    if (url.includes('?id=')) return Response.json({ ok: true, ...results.get(decodeURIComponent(url.split('?id=')[1]!)) });
    return Response.json({ ok: true, version: '0.2.40', records: rows, ...(customRuns ? { actorRuns: ledger } : {}), settings: { egress: 'actor-public', geo: 'US', cache: true } });
  });
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, queries: () => fetcher.mock.calls.filter(([, init]) => init?.body && JSON.parse(String(init.body)).action === 'query'), rows: () => rows };
}

describe('dashboard interactions', () => {
  it('opens Query by default with a 7-day window, switches to History without querying, and opens Host settings', async () => {
    const h = api(), openSettings = vi.fn(), user = userEvent.setup();
    render(<Dashboard t={t} openSettings={openSettings} />);
    await screen.findByText('v0.2.40');
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'Query' }).getAttribute('aria-selected')).toBe('true');
    expect((screen.getByRole('combobox', { name: 'Time range' }) as HTMLInputElement).value).toBe('Past week');
    // Empty-state example chips fill the input without sending a query.
    await user.click(screen.getByRole('button', { name: 'ChatGPT, Gemini' }));
    expect((screen.getByRole('textbox', { name: /Keywords/ }) as HTMLInputElement).value).toBe('ChatGPT, Gemini');
    await user.click(screen.getByRole('tab', { name: /History/ }));
    await user.click(screen.getByRole('button', { name: 'Plugin settings' }));
    expect(openSettings).toHaveBeenCalledOnce(); expect(h.queries()).toHaveLength(0);
  });
  it.each(['single', 'compare'].flatMap(mode => times.map((time, index) => ({ mode, time, index }))))('preserves $time in $mode queries, records and row replay', async ({ mode, time, index }) => {
    const h = api(), user = userEvent.setup(); const { container } = render(<Dashboard t={t} />);
    await screen.findByText('v0.2.40');
    const input = screen.getByRole('textbox', { name: /Keywords/ });
    await user.clear(input); await user.type(input, mode === 'single' ? 'ChatGPT' : 'ChatGPT, Gemini');
    await user.click(screen.getByRole('combobox', { name: 'Time range' }));
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(9); await user.click(options[index]!);
    const selectedLabel = (screen.getByRole('combobox', { name: 'Time range' }) as HTMLInputElement).value;
    await user.click(screen.getByRole('button', { name: 'Query trends' }));
    await waitFor(() => expect(h.rows()[0]?.time).toBe(time));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Query trends' }) as HTMLButtonElement).disabled).toBe(false));
    expect(h.queries()).toHaveLength(1);
    await user.click(screen.getByRole('tab', { name: /History/ }));
    expect(container.querySelector('.gd-summary-stat strong')!.textContent).toBe('1');
    const before = h.queries().length;
    await user.click(container.querySelector('tbody tr.gd-record-row')!);
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Time range' }) as HTMLInputElement).value).toBe(selectedLabel));
    expect(h.queries()).toHaveLength(before);
  });
  it('switches automatically to Estimated searches after a successful batch volume calibration', async () => {
    const h = api(), user = userEvent.setup(); render(<Dashboard t={t} />);
    await screen.findByText('v0.2.40');
    await user.type(screen.getByRole('textbox', { name: /Keywords/ }), 'ChatGPT');
    await user.click(screen.getByRole('button', { name: 'Query trends' }));
    await waitFor(() => expect(h.rows()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Estimate daily searches' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Estimated searches' }).getAttribute('aria-pressed')).toBe('true'));
    const sourceLink = screen.getByRole('link', { name: DASHBOARD_EN.dashAnchorSourceLink });
    expect(sourceLink.getAttribute('href')).toBe('https://meka.im/datasets/google-trends-anchors');
    expect(sourceLink.getAttribute('target')).toBe('_blank');
    expect(sourceLink.getAttribute('rel')).toBe('noopener noreferrer');
  });
  it('cancels deletion, then clears a selected result and updates totals without a query', async () => {
    const h = api(), user = userEvent.setup(), { container } = render(<Dashboard t={t} />);
    await screen.findByText('v0.2.40');
    await user.type(screen.getByRole('textbox', { name: /Keywords/ }), 'ChatGPT');
    await user.click(screen.getByRole('button', { name: 'Query trends' })); await waitFor(() => expect(h.rows()).toHaveLength(1));
    await user.click(screen.getByRole('tab', { name: /History/ }));
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })); expect(h.rows()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm clear' }));
    await screen.findByText('No query history yet');
    expect(container.querySelector('.gd-summary-stat strong')!.textContent).toBe('0'); expect(h.queries()).toHaveLength(1);
  });
  it('rejects duplicate comparison terms before issuing a request', async () => {
    const h = api(), user = userEvent.setup(); render(<Dashboard t={t} />);
    await screen.findByText('v0.2.40');
    fireEvent.change(screen.getByRole('textbox', { name: /Keywords/ }), { target: { value: 'ChatGPT, chatgpt' } });
    await user.click(screen.getByRole('button', { name: 'Query trends' }));
    expect(screen.getByRole('alert').textContent).toContain('distinct'); expect(h.queries()).toHaveLength(0);
  });
  it('retains null traffic and gap points when adapting a real snapshot envelope', () => {
    const saved = { record: { terms: ['ChatGPT'] }, result: { series: { points: [{ t: '2026-01-01', score: 80, traffic: null }, { t: '2026-01-02', score: 0, traffic: null, gap: true }] }, traffic: { average: null, latest: null, peak: null } } } as unknown as SavedQuery;
    expect(resultSeries(saved, true)[0]).toMatchObject({ average: null, latest: null, peak: null, points: [{ value: null }, { value: null }] });
    expect(resultSeries(saved)[0]!.points.map(point => point.value)).toEqual([80, null]);
  });
  it('keeps an updated follow-up window off the original chart', () => {
    const saved = { record: { terms: ['Alpha'], tool: 'trends_compare' }, result: { series: [] },
      volumeChecks: [{ keyword: 'Alpha', sameWindow: false, estimate: { traffic: { average: 1000 }, points: [{ t: '2026-11-19', value: 1000 }] } }],
    } as unknown as SavedQuery;
    expect(resultSeries(saved, true)[0]).toMatchObject({ average: null, points: [] });
    saved.volumeChecks![0]!.sameWindow = true;
    expect(resultSeries(saved, true)[0]).toMatchObject({ average: 1000, points: [{ t: '2026-11-19', value: 1000 }] });
  });
  it('renders a saved per-day band with its large comparison on a readable scale', () => {
    const dates = Array.from({ length: 5 }, (_, i) => new Date(Date.UTC(2026, 10, i + 1)).toISOString());
    const band = dates.map((t, i) => ({ t, low: i === 2 ? null : 700, high: i === 2 ? null : 1600 }));
    const saved = { record: { tool: 'trends_compare', terms: ['Alpha', 'Beta'] }, result: { series: [], calibration: { series: [
      { keyword: 'Beta', traffic: { average: 500000 }, points: dates.map(t => ({ t, value: 500000 })) },
    ] } }, volumeChecks: [{ keyword: 'Alpha', sameWindow: true, estimate: { traffic: { average: null }, points: [],
      range: { low: 700, high: 1600, points: band } } }],
    } as unknown as SavedQuery;
    const series = resultSeries(saved, true).map((term, index) => ({ ...term, color: index === 0 ? 'blue' : 'purple' }));
    const { container } = render(<TrendChart series={series} traffic label="Volume" empty="No curve" logLabel="Log scale" />);
    expect(screen.getByRole('img', { name: 'Volume · Log scale' })).toBeDefined();
    expect(container.querySelectorAll('path[fill="blue"]')).toHaveLength(2);
    expect(container.querySelectorAll('path[stroke="purple"]')).toHaveLength(1);
  });
  it('keeps one in-flight query alive across leaving and reopening the panel, including real progress', async () => {
    let finish!: () => void;
    const h = api(new Promise<void>(resolve => { finish = resolve; })), user = userEvent.setup();
    const controller = new DashboardController(); controllers.push(controller);
    const initial = render(<Dashboard t={t} controller={controller} />);
    await screen.findByText('v0.2.40');
    await user.type(screen.getByRole('textbox', { name: /Keywords/ }), 'ChatGPT, Gemini');
    expect(screen.queryByRole('button', { name: 'Single term' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Compare terms' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Query trends' }));
    const signal = h.queries()[0]![1]!.signal!;
    initial.unmount();
    expect(signal.aborted).toBe(false);
    await waitFor(() => expect(controller.getSnapshot().operation?.phase).toBe('running'), { timeout: 3000 });
    render(<Dashboard t={t} controller={controller} />);
    expect((screen.getByRole('textbox', { name: /Keywords/ }) as HTMLInputElement).value).toBe('ChatGPT, Gemini');
    const progress = screen.getByRole('progressbar', { name: 'Actor is fetching data' });
    expect(progress.getAttribute('aria-valuenow')).toBeNull();
    expect(progress.getAttribute('aria-valuetext')).toContain('Elapsed');
    finish();
    await waitFor(() => expect(controller.getSnapshot().operation).toBeNull());
    expect(controller.getSnapshot().result?.record.terms).toEqual(['ChatGPT', 'Gemini']);
    expect(h.queries()).toHaveLength(1);
  });
  it('restores a completed result and unsent draft after creating a fresh page controller', async () => {
    const h = api(), controller = new DashboardController(); controllers.push(controller);
    await controller.refresh(); controller.set('tab', 'query'); controller.set('text', 'ChatGPT'); controller.set('time', 'today 5-y');
    await controller.run(); controller.set('text', 'unsent draft');
    controller.dispose();
    const restored = new DashboardController(); controllers.push(restored); await restored.refresh();
    expect(restored.getSnapshot()).toMatchObject({ tab: 'query', text: 'unsent draft', time: 'today 5-y' });
    expect(restored.getSnapshot().result?.record.terms).toEqual(['ChatGPT']);
    expect(h.queries()).toHaveLength(1);
  });
  it('keeps select text padding separate from the arrow button and validates six keywords inline', async () => {
    const h = api(), user = userEvent.setup(), { container } = render(<Dashboard t={t} />);
    await screen.findByText('v0.2.40');
    const control = container.querySelector('.gtfa-choice-control')!;
    expect(getComputedStyle(control).paddingLeft).toBe('0px');
    expect(getComputedStyle(control).height).toBe('40px');
    const input = screen.getByRole('textbox', { name: /Keywords/ });
    fireEvent.change(input, { target: { value: 'A, B, C, D, E, F' } });
    await user.click(screen.getByRole('button', { name: 'Query trends' }));
    expect(screen.getByRole('alert').closest('form')).not.toBeNull();
    fireEvent.change(input, { target: { value: 'A, B' } });
    expect(screen.queryByRole('alert')).toBeNull(); expect(h.queries()).toHaveLength(0);
  });
  it('submits five comma-separated terms together and restores their result without a second query', async () => {
    const h = api(), user = userEvent.setup(); render(<Dashboard t={t} />);
    await screen.findByText('v0.2.40');
    const keywords = ['ChatGPT', 'Gemini', 'Claude', 'DeepSeek', 'sudoku'];
    fireEvent.change(screen.getByRole('textbox', { name: /Keywords/ }), { target: { value: keywords.join('，') } });
    await user.click(screen.getByRole('button', { name: 'Query trends' }));
    await waitFor(() => expect(h.rows()).toHaveLength(1));
    expect(JSON.parse(String(h.queries()[0]![1]!.body)).input.keywords).toEqual(keywords);
    await user.click(screen.getByRole('tab', { name: /History/ }));
    await user.click(screen.getByRole('tab', { name: 'Query' }));
    expect(screen.getByRole('heading', { name: new RegExp(keywords.join(' vs ')) })).toBeDefined();
    expect(h.queries()).toHaveLength(1);
  });

  it('switches between By query and By Actor run views, formats sub-cent costs, syncs pending billing, and shows linked runs in Query details', async () => {
    const nowIso = new Date().toISOString();
    const h = api(undefined, [
      {
        runId: 'run-calib-pending', actorId: 'owner~gtfa', egress: 'actor-own', purpose: 'batch-round', round: 1, anchor: 'sudoku',
        source: 'manual', tool: 'trends_compare', terms: ['ChatGPT'], geo: 'US', time: 'today 1-m',
        status: 'SUCCEEDED', toolStatus: 'ok', startedAt: nowIso, finishedAt: nowIso, durationMs: 4200, costUsd: null, queryRecordId: '00000000-0000-4000-8000-999999999999',
      },
      {
        runId: 'run-probe-micro', actorId: 'owner~gtfa', egress: 'actor-own', purpose: 'connection-test',
        source: 'settings', tool: 'trends_compare', terms: ['ChatGPT', 'Gemini', 'weather'], geo: 'US', time: 'now 1-d',
        status: 'SUCCEEDED', toolStatus: 'ok', startedAt: nowIso, finishedAt: nowIso, durationMs: 2800, costUsd: 0.00006, queryRecordId: null,
      },
    ]);
    const user = userEvent.setup();
    render(<Dashboard t={t} />);
    await screen.findByText('v0.2.40');

    // Run a query so a linked query record exists alongside the connection test and cleared-query pending run.
    await user.type(screen.getByRole('textbox', { name: /Keywords/ }), 'ChatGPT');
    await user.click(screen.getByRole('button', { name: 'Query trends' }));
    await waitFor(() => expect(h.rows()).toHaveLength(1));

    // Query details shows Actor cost summary and linked Actor run cost.
    await user.click(screen.getByText('Query details'));
    expect(screen.getByText('Actor cost')).toBeTruthy();
    expect(screen.getByText('Linked Actor runs (1)')).toBeTruthy();
    expect(screen.getAllByText('1 Actor run · $0.0003')).toHaveLength(2);

    // Switch to History and check per-row Cost column in By query view (2 top-level tabs only).
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    await user.click(screen.getByRole('tab', { name: /History/ }));
    expect(screen.getByRole('columnheader', { name: 'Cost' })).toBeTruthy();
    expect(within(document.querySelector('.gd-queries-table')!).getByText('$0.0003')).toBeTruthy();

    // Switch to By Actor run view.
    await user.click(screen.getByRole('button', { name: /By Actor run/ }));
    expect(screen.getByText('Calibration R1')).toBeTruthy();
    expect(screen.getByText('Connection test')).toBeTruthy();
    expect(screen.getByText('<$0.0001')).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('Probe')).toBeTruthy();
    expect(screen.getByText('Cleared')).toBeTruthy();

    // Sync pending resolves costUsd: null into $0.0002 via reconcileRuns without issuing a query.
    const beforeQueries = h.queries().length;
    await user.click(screen.getByRole('button', { name: /Sync pending/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Sync pending/ })).toBeNull());
    expect(screen.getByText('$0.0002')).toBeTruthy();
    expect(within(document.querySelector('.gd-summary-strip')!).getByText('$0.0005')).toBeTruthy();
    expect(h.queries()).toHaveLength(beforeQueries);

    // Clicking View on the primary Actor run switches back to Query result without running a new query.
    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByRole('tab', { name: 'Query' }).getAttribute('aria-selected')).toBe('true');
    expect(h.queries()).toHaveLength(beforeQueries);
  });

  it('shows a concise local rate-limit banner with Actor switch CTA and clean failed-state details', async () => {
    const id = '00000000-0000-4000-8000-000000000429';
    const createdAt = new Date().toISOString();
    const failedRecord: QueryRecord = {
      id, tool: 'trends_compare', terms: ['Cursor', 'Claude', 'DeepSeek'], geo: 'US', time: 'now 7-d',
      source: 'manual', egress: 'local', status: 'blocked', cached: false, createdAt, fetchedAt: createdAt,
      durationMs: 6600, actorRunId: null, costUsd: 0, errorCode: 'RATE_LIMITED',
    };
    const failedResult = {
      ok: false, status: 'blocked', onDemand: true, series: [],
      error: { code: 'RATE_LIMITED', message: 'Google Trends rate limit (HTTP 429). Wait a few seconds before retrying; lower request rate or set HTTPS_PROXY/HTTP_PROXY.' },
      filter: { geo: 'US', time: 'now 7-d' }, meta: { queryRecordId: id },
    };
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body?.action === 'query') return Response.json({ ok: true, result: failedResult });
      if (url.includes(`?id=${id}`)) return Response.json({ ok: true, record: failedRecord, result: failedResult, actorRuns: [] });
      return Response.json({ ok: true, version: '0.2.44', records: [failedRecord], actorRuns: [], settings: { egress: 'local', geo: 'US', cache: true } });
    });
    vi.stubGlobal('fetch', fetcher);

    const openSettings = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<Dashboard t={t} openSettings={openSettings} renderSettings={() => <div data-testid="embedded-settings">Embedded Settings Form</div>} />);
    await screen.findByText('v0.2.44');

    const alert = await screen.findByRole('alert');
    expect(alert.className).toContain('gd-local-alert');
    expect(alert.textContent).toContain(DASHBOARD_EN.dashLocalFailRateLimited);
    expect(alert.textContent).toContain(DASHBOARD_EN.dashLocalFailBody);
    // Raw technical detail lives inside expanded Query details rather than bloating the top banner.
    expect(alert.textContent).not.toContain('HTTP 429');

    // No redundant bottom .gd-error bar, no misleading "Insufficient comparison data" pills, and no empty volume cards.
    expect(container.querySelector('.gd-error')).toBeNull();
    expect(screen.queryByText(DASHBOARD_EN.dashNoSharedSeries)).toBeNull();
    expect(screen.queryByText(DASHBOARD_EN.dashDailyVolume)).toBeNull();

    // Query details is expanded automatically and holds the raw error detail cleanly.
    const details = container.querySelector('.gd-query-details') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(details.textContent).toContain('HTTP 429');

    // 1-click CTA opens the clean embedded settings view directly without calling navigation.openBundle.
    await user.click(screen.getByRole('button', { name: DASHBOARD_EN.dashLocalFailCta }));
    expect(screen.getByTestId('embedded-settings')).toBeDefined();
    expect(openSettings).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: DASHBOARD_EN.dashBackToQuery }));
    expect(screen.queryByTestId('embedded-settings')).toBeNull();
  });

  it('hides the switch-to-Actor banner on an older local failure once current egress is already an Actor', async () => {
    const id = '00000000-0000-4000-8000-000000000430';
    const createdAt = new Date().toISOString();
    const failedRecord: QueryRecord = {
      id, tool: 'trends_compare', terms: ['Cursor', 'Claude', 'DeepSeek'], geo: 'US', time: 'now 7-d',
      source: 'manual', egress: 'local', status: 'blocked', cached: false, createdAt, fetchedAt: createdAt,
      durationMs: 6600, actorRunId: null, costUsd: 0, errorCode: 'RATE_LIMITED',
    };
    const failedResult = {
      ok: false, status: 'blocked', onDemand: true, series: [],
      error: { code: 'RATE_LIMITED', message: 'Google Trends rate limit (HTTP 429).' },
      filter: { geo: 'US', time: 'now 7-d' }, meta: { queryRecordId: id },
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes(`?id=${id}`)) return Response.json({ ok: true, record: failedRecord, result: failedResult, actorRuns: [] });
      return Response.json({ ok: true, version: '0.2.44', records: [failedRecord], actorRuns: [], settings: { egress: 'actor-public', geo: 'US', cache: true } });
    }));

    const { container } = render(<Dashboard t={t} renderSettings={() => <div />} />);
    await screen.findByText(DASHBOARD_EN.dashFailedEmptyHintSwitched);
    expect(container.querySelector('.gd-local-alert')).toBeNull();
    expect(container.querySelector('.gd-error')).toBeNull();
    expect(screen.queryByRole('button', { name: DASHBOARD_EN.dashLocalFailCta })).toBeNull();
  });

  it('keeps dashboard English/Chinese dictionaries in sync and removes the !important error margin override', () => {
    expect(Object.keys(DASHBOARD_ZH).sort()).toEqual(Object.keys(DASHBOARD_EN).sort());
    expect(DASHBOARD_CSS).not.toContain('margin:0 0 16px!important');
  });

  it('clears the previous query result immediately while a new query is in flight', async () => {
    let finishSecond!: () => void;
    const secondDelay = new Promise<void>(resolve => { finishSecond = resolve; });
    let queryCount = 0;
    const rows: QueryRecord[] = [];
    const results = new Map<string, SavedQuery>();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (url.includes('?progress=')) return Response.json({ ok: true, progress: { requestId: url.split('?progress=')[1], phase: 'starting', startedAt: Date.now() } });
      if (body?.action === 'query') {
        queryCount += 1;
        if (queryCount === 2) await secondDelay;
        const term = body.input.term as string;
        const id = `00000000-0000-4000-8000-${String(queryCount).padStart(12, '0')}`;
        const record: QueryRecord = { id, tool: body.name, terms: [term], geo: body.input.geo, time: body.input.time, source: 'manual', egress: 'actor-public', status: 'ok', cached: false,
          createdAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), durationMs: 1000, actorRunId: `run-${id}`, costUsd: 0.0002, errorCode: null };
        const result = { ok: true, status: 'ok', onDemand: true, series: [{ keyword: term, average: 50, latest: 50, peak: 50, points: [{ t: '2026-11-25', value: 50 }, { t: '2026-11-26', value: 50 }] }], filter: { geo: record.geo, time: record.time }, meta: { queryRecordId: id } };
        rows.unshift(record); results.set(id, { record, result, actorRuns: [] });
        return Response.json({ ok: true, result });
      }
      if (url.includes('?id=')) return Response.json({ ok: true, ...results.get(decodeURIComponent(url.split('?id=')[1]!)) });
      return Response.json({ ok: true, version: '0.2.44', records: rows, actorRuns: [], settings: { egress: 'actor-public', geo: 'US', cache: true } });
    }));

    const user = userEvent.setup();
    render(<Dashboard t={t} />);
    await screen.findByText('v0.2.44');

    const input = screen.getByRole('textbox', { name: /Keywords/ });
    await user.type(input, 'duo');
    await user.click(screen.getByRole('button', { name: 'Query trends' }));
    await screen.findByRole('heading', { name: 'duo' });

    await user.clear(input);
    await user.type(input, 'poke');
    await user.click(screen.getByRole('button', { name: 'Query trends' }));

    // Previous result ("duo") clears immediately instead of staying on screen during loading.
    expect(screen.queryByRole('heading', { name: 'duo' })).toBeNull();
    expect(screen.queryByText(DASHBOARD_EN.dashEmptyResult)).toBeNull();
    expect(screen.getByRole('progressbar')).toBeDefined();

    finishSecond();
    await screen.findByRole('heading', { name: 'poke' });
  });
});
