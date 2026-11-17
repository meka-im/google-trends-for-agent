// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dashboard, resultSeries } from '../src/client/dashboard.js';
import { DASHBOARD_EN } from '../src/client/dashboard-locale.js';
import type { QueryRecord, SavedQuery } from '../src/query-history-types.js';

const t = (key: string) => DASHBOARD_EN[key] ?? key;
const times = ['now 1-H', 'now 4-H', 'now 1-d', 'now 7-d', 'today 1-m', 'today 3-m', 'today 12-m', 'today 5-y', 'all'];
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function api() {
  let rows: QueryRecord[] = []; const results = new Map<string, SavedQuery>();
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (body?.action === 'clear') { rows = rows.filter(row => !body.ids.includes(row.id)); return Response.json({ ok: true }); }
    if (body?.action === 'query') {
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
  it('preserves all nine time ranges in single and comparison submissions, records and replay', async () => {
    const h = api(), user = userEvent.setup(); const { container } = render(<Dashboard t={t} />);
    await screen.findByText('v0.2.25');
    await user.click(screen.getByRole('tab', { name: 'Query' }));
    for (const mode of ['single', 'compare']) {
      await user.click(screen.getByRole('button', { name: mode === 'single' ? 'Single term' : 'Compare terms' }));
      const input = screen.getByRole('textbox', { name: mode === 'single' ? 'Keyword' : /Keywords/ });
      await user.clear(input); await user.type(input, mode === 'single' ? 'ChatGPT' : 'ChatGPT, Gemini');
      for (const [index, time] of times.entries()) {
        await user.click(screen.getByRole('combobox', { name: 'Time range' }));
        const options = screen.getAllByRole('option');
        expect(options).toHaveLength(9); await user.click(options[index]!);
        await user.click(screen.getByRole('button', { name: 'Query trends' }));
        await waitFor(() => expect(h.rows()[0]?.time).toBe(time));
        await waitFor(() => expect((screen.getByRole('button', { name: 'Query trends' }) as HTMLButtonElement).disabled).toBe(false));
      }
    }
    expect(h.queries()).toHaveLength(18);
    await user.click(screen.getByRole('tab', { name: /History/ }));
    const before = h.queries().length;
    await user.click(screen.getAllByRole('button', { name: 'View' })[0]!);
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Time range' }) as HTMLInputElement).value).toBe('All time'));
    expect(h.queries()).toHaveLength(before);
    await user.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(container.querySelector('.gd-metric strong')!.textContent).toBe('18');
  });
  it('cancels deletion, then clears a selected result and updates totals without a query', async () => {
    const h = api(), user = userEvent.setup(), { container } = render(<Dashboard t={t} />);
    await screen.findByText('v0.2.25'); await user.click(screen.getByRole('tab', { name: 'Query' }));
    await user.type(screen.getByRole('textbox', { name: 'Keyword' }), 'ChatGPT');
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
    await user.click(screen.getByRole('button', { name: 'Compare terms' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Keywords/ }), { target: { value: 'ChatGPT, chatgpt' } });
    await user.click(screen.getByRole('button', { name: 'Query trends' }));
    expect(screen.getByRole('alert').textContent).toContain('distinct'); expect(h.queries()).toHaveLength(0);
  });
  it('retains null traffic and gap points when adapting a real snapshot envelope', () => {
    const saved = { record: { terms: ['ChatGPT'] }, result: { series: { points: [{ t: '2026-01-01', score: 80, traffic: null }, { t: '2026-01-02', score: 0, traffic: null, gap: true }] }, traffic: { average: null, latest: null, peak: null } } } as unknown as SavedQuery;
    expect(resultSeries(saved, true)[0]).toMatchObject({ average: null, latest: null, peak: null, points: [{ value: null }, { value: null }] });
    expect(resultSeries(saved)[0]!.points.map(point => point.value)).toEqual([80, null]);
  });
});
