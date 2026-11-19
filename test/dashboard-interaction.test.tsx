// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard, resultSeries } from '../src/client/dashboard.js';
import { TrendChart } from '../src/client/trend-chart.js';
import { DashboardController } from '../src/client/dashboard-state.js';
import { DASHBOARD_EN } from '../src/client/dashboard-locale.js';
import type { QueryRecord, SavedQuery } from '../src/query-history-types.js';

const t = (key: string) => DASHBOARD_EN[key] ?? key;
const times = ['now 1-H', 'now 4-H', 'now 1-d', 'now 7-d', 'today 1-m', 'today 3-m', 'today 12-m', 'today 5-y', 'all'];
const controllers: DashboardController[] = [];
beforeEach(() => {
  sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); controllers.splice(0).forEach(controller => controller.dispose()); vi.restoreAllMocks(); });
function api(delay?: Promise<void>) {
  let rows: QueryRecord[] = []; const results = new Map<string, SavedQuery>();
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (url.includes('?progress=')) return Response.json({ ok: true, progress: { requestId: url.split('?progress=')[1], phase: 'running', startedAt: Date.now() - 3000 } });
    if (body?.action === 'clear') { rows = rows.filter(row => !body.ids.includes(row.id)); return Response.json({ ok: true }); }
    if (body?.action === 'query') {
      await delay;
      const id = `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`;
      const record: QueryRecord = { id, tool: body.name, terms: body.input.keywords ?? [body.input.term], geo: body.input.geo, time: body.input.time, source: 'manual', egress: 'actor-public', status: 'ok', cached: false,
        createdAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), durationMs: 3100, actorRunId: `run-${id}`, costUsd: null, errorCode: null };
      const series = record.terms.map(term => ({ keyword: term, average: 25, latest: 30, peak: 30, points: [{ t: '2026-01-01', value: 20 }, { t: '2026-11-01', value: 30 }] }));
      const result = { ok: true, status: 'ok', series, filter: { geo: record.geo, time: record.time }, meta: { queryRecordId: id } };
      rows.unshift(record); results.set(id, { record, result }); return Response.json({ ok: true, result });
    }
    if (url.includes('?id=')) return Response.json({ ok: true, ...results.get(decodeURIComponent(url.split('?id=')[1]!)) });
    return Response.json({ ok: true, version: '0.2.25', records: rows, settings: { egress: 'actor-public', geo: 'US', cache: true } });
  });
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, queries: () => fetcher.mock.calls.filter(([, init]) => init?.body && JSON.parse(String(init.body)).action === 'query'), rows: () => rows };
}

describe('dashboard interactions', () => {
  it('opens all three tabs without querying and uses the existing Host settings navigation', async () => {
    const h = api(), openSettings = vi.fn(), user = userEvent.setup();
    render(<Dashboard t={t} openSettings={openSettings} />);
    await screen.findByText('v0.2.25');
    await user.click(screen.getByRole('tab', { name: 'Query' }));
    await user.click(screen.getByRole('tab', { name: /History/ }));
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    await user.click(screen.getByRole('button', { name: 'Plugin settings' }));
    expect(openSettings).toHaveBeenCalledOnce(); expect(h.queries()).toHaveLength(0);
  });
  it.each(['single', 'compare'].flatMap(mode => times.map((time, index) => ({ mode, time, index }))))('preserves $time in $mode queries, records and replay', async ({ mode, time, index }) => {
    const h = api(), user = userEvent.setup(); const { container } = render(<Dashboard t={t} />);
    await screen.findByText('v0.2.25');
    await user.click(screen.getByRole('tab', { name: 'Query' }));
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
    const before = h.queries().length;
    await user.click(screen.getAllByRole('button', { name: 'View' })[0]!);
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Time range' }) as HTMLInputElement).value).toBe(selectedLabel));
    expect(h.queries()).toHaveLength(before);
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(container.querySelector('.gd-metric strong')!.textContent).toBe('1');
  });
  it('cancels deletion, then clears a selected result and updates totals without a query', async () => {
    const h = api(), user = userEvent.setup(), { container } = render(<Dashboard t={t} />);
    await screen.findByText('v0.2.25'); await user.click(screen.getByRole('tab', { name: 'Query' }));
    await user.type(screen.getByRole('textbox', { name: /Keywords/ }), 'ChatGPT');
    await user.click(screen.getByRole('button', { name: 'Query trends' })); await waitFor(() => expect(h.rows()).toHaveLength(1));
    await user.click(screen.getByRole('tab', { name: /History/ }));
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })); expect(h.rows()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm clear' }));
    await screen.findByText('No query history yet');
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(container.querySelector('.gd-metric strong')!.textContent).toBe('0'); expect(h.queries()).toHaveLength(1);
  });
  it('rejects duplicate comparison terms before issuing a request', async () => {
    const h = api(), user = userEvent.setup(); render(<Dashboard t={t} />);
    await screen.findByText('v0.2.25'); await user.click(screen.getByRole('tab', { name: 'Query' }));
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
    await screen.findByText('v0.2.25'); await user.click(screen.getByRole('tab', { name: 'Query' }));
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
    await screen.findByText('v0.2.25');
    const control = container.querySelector('.gtfa-choice-control')!;
    expect(getComputedStyle(control).paddingLeft).toBe('0px');
    expect(getComputedStyle(control).height).toBe('40px');
    await user.click(screen.getByRole('tab', { name: 'Query' }));
    const input = screen.getByRole('textbox', { name: /Keywords/ });
    fireEvent.change(input, { target: { value: 'A, B, C, D, E, F' } });
    await user.click(screen.getByRole('button', { name: 'Query trends' }));
    expect(screen.getByRole('alert').closest('form')).not.toBeNull();
    fireEvent.change(input, { target: { value: 'A, B' } });
    expect(screen.queryByRole('alert')).toBeNull(); expect(h.queries()).toHaveLength(0);
  });
  it('submits five comma-separated terms together and restores their result without a second query', async () => {
    const h = api(), user = userEvent.setup(); render(<Dashboard t={t} />);
    await screen.findByText('v0.2.25'); await user.click(screen.getByRole('tab', { name: 'Query' }));
    const keywords = ['ChatGPT', 'Gemini', 'Claude', 'DeepSeek', 'sudoku'];
    fireEvent.change(screen.getByRole('textbox', { name: /Keywords/ }), { target: { value: keywords.join('，') } });
    await user.click(screen.getByRole('button', { name: 'Query trends' }));
    await waitFor(() => expect(h.rows()).toHaveLength(1));
    expect(JSON.parse(String(h.queries()[0]![1]!.body)).input.keywords).toEqual(keywords);
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    await user.click(screen.getByRole('tab', { name: 'Query' }));
    expect(screen.getByRole('heading', { name: new RegExp(keywords.join(' vs ')) })).toBeDefined();
    expect(h.queries()).toHaveLength(1);
  });
});
