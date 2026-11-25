import { GTrendsError, parseGTrendsInput, type GTrendsInput } from './core.js';
export const MAX_BATCH_ITEMS = 20, MAX_BATCH_BUDGET_MS = 60000;
export type TrendsFormat = 'json' | 'csv' | 'xml' | 'html';
export interface TrendsPlan {
    inputs: GTrendsInput[];
    batch: boolean;
    format: TrendsFormat;
    budgetMs: number;
    maxItems: number;
}
const bad = (m: string): never => {
    throw new GTrendsError('INVALID_INPUT', m);
};
const extra = ['mode', 'urls', 'spreadsheetId', 'sheet', 'gid', 'sheetColumn', 'maxItems', 'skipHeader', 'format', 'batchBudgetMs'];
export function parseExploreUrl(value: unknown, base: Record<string, unknown>): GTrendsInput {
    if (typeof value !== 'string')
        return bad('urls items must be Explore URLs');
    let u: URL;
    try {
        u = new URL(value);
    }
    catch {
        return bad('invalid Explore URL');
    }
    if (u.protocol !== 'https:' || u.hostname !== 'trends.google.com' || !/^\/trends\/explore\/?$/.test(u.pathname) || u.username || u.password || u.port)
        return bad('only https://trends.google.com/trends/explore URLs are supported');
    const p = u.searchParams;
    for (const key of ['q', 'geo', 'date', 'cat', 'gprop', 'hl', 'tz'])
        if (p.getAll(key).length > 1)
            return bad('duplicate Explore URL parameter');
    if (!p.has('q'))
        return bad('Explore URL requires q');
    const v: Record<string, unknown> = { ...base, queries: p.get('q')!.split(',') };
    for (const [a, b] of [['geo', 'geo'], ['hl', 'locale']] as const)
        if (p.has(a))
            v[b] = p.get(a);
    if (p.has('cat')) {
        if (!/^\d+$/.test(p.get('cat')!))
            return bad('invalid URL cat');
        v.category = Number(p.get('cat'));
    }
    if (p.has('tz')) {
        if (!/^-?\d+$/.test(p.get('tz')!))
            return bad('invalid URL tz');
        v.timezoneOffsetMinutes = -Number(p.get('tz'));
    }
    if (p.has('gprop')) {
        const props: Record<string, string> = { '': 'web', images: 'images', news: 'news', youtube: 'youtube', froogle: 'shopping' };
        if (!(p.get('gprop')! in props))
            return bad('invalid URL gprop');
        v.searchType = props[p.get('gprop')!];
    }
    if (p.has('date')) {
        delete v.timeRange;
        delete v.startDate;
        delete v.endDate;
        const d = p.get('date')!;
        const m = /^(\d{4}-\d{2}-\d{2}) (\d{4}-\d{2}-\d{2})$/.exec(d);
        if (m) {
            v.startDate = m[1];
            v.endDate = m[2];
        }
        else
            v.timeRange = d;
    }
    return parseGTrendsInput(v);
}
export function parseSheetCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [], cell = '', quoted = false, closed = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (closed && c !== ',' && c !== '\n' && c !== '\r')
            return bad('invalid CSV after closing quote');
        if (c === '"') {
            if (quoted && text[i + 1] === '"') {
                cell += '"';
                i++;
            }
            else if (!quoted && cell.length)
                return bad('invalid CSV');
            else {
                quoted = !quoted;
                if (!quoted)
                    closed = true;
            }
        }
        else if (c === ',' && !quoted) {
            row.push(cell);
            cell = '';
            closed = false;
        }
        else if ((c === '\n' || c === '\r') && !quoted) {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            closed = false;
        }
        else
            cell += c;
    }
    if (quoted)
        return bad('invalid CSV');
    if (cell.length || row.length || closed) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}
export async function planTrendsRequest(raw: unknown): Promise<TrendsPlan> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return bad('request must be object');
    const r = raw as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(r, 'screenshot'))
        return bad('screenshot is no longer supported');
    if (['spreadsheetId', 'sheet', 'gid', 'sheetColumn', 'skipHeader'].some(k => r[k] !== undefined)) return bad('spreadsheet import is not supported');
    const sources = ['queries', 'urls'].filter(k => r[k] !== undefined);
    if (sources.length !== 1)
        return bad('exactly one of queries, urls is required');
    const format = (r.format ?? 'json') as TrendsFormat;
    if (!['json', 'csv', 'xml', 'html'].includes(format))
        return bad('unsupported format');
    const mode = r.mode ?? 'compare';
    if (sources[0] === 'queries' && mode === 'compare' && r.maxItems !== undefined)
        return bad('maxItems requires batch input');
    if (mode !== 'compare' && mode !== 'individual')
        return bad('mode must be compare or individual');
    const budgetMs = r.batchBudgetMs ?? MAX_BATCH_BUDGET_MS;
    if (typeof budgetMs !== 'number' || !Number.isInteger(budgetMs) || budgetMs < 1000 || budgetMs > MAX_BATCH_BUDGET_MS)
        return bad('batchBudgetMs must be 1000..60000');
    const base = Object.fromEntries(Object.entries(r).filter(([k]) => !extra.includes(k)));
    let inputs: GTrendsInput[] = [];
    const maxItems = r.maxItems ?? 20;
    if (typeof maxItems !== 'number' || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > 20)
        return bad('maxItems must be 1..20');
    if (sources[0] === 'queries') {
        if (mode === 'compare')
            inputs = [parseGTrendsInput(base)];
        else {
            if (!Array.isArray(r.queries) || !r.queries.length || r.queries.length > 20)
                return bad('individual queries must contain 1..20 items');
            inputs = r.queries.map(q => parseGTrendsInput({ ...base, queries: [q] }));
        }
    }
    else if (sources[0] === 'urls') {
        if (!Array.isArray(r.urls) || !r.urls.length || r.urls.length > 20)
            return bad('urls must contain 1..20 items');
        inputs = r.urls.map(u => parseExploreUrl(u, base));
    }
    else return bad('spreadsheet import is not supported');
    if (inputs.length > maxItems) return bad('input count exceeds maxItems');
    return { inputs, maxItems, batch: sources[0] !== 'queries' || mode === 'individual', format, budgetMs };
}
