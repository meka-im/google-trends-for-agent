export type GTrendsExportFormat = 'json' | 'csv' | 'xml' | 'html';
export interface GTrendsExport { body: BodyInit; contentType: string; filename: string }
type Scalar = string | number | boolean | null;
type Row = Record<string, Scalar>;
type TableName = 'timeline' | 'geo' | 'related_queries' | 'related_topics' | 'metadata' | 'errors' | 'unprocessed';
type Tables = Record<TableName, Row[]>;
const obj = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const scalar = (value: unknown): Scalar => value == null ? null : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string' ? value : String(value);

function flatten(value: unknown, path = '', out: Row = {}): Row {
  if (Array.isArray(value)) {
    if (!value.length) out[path] = '[]';
    value.forEach((item, index) => flatten(item, `${path}[${index}]`, out));
  } else if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) out[path] = '{}';
    for (const [key, item] of entries) flatten(item, path ? `${path}.${key}` : key, out);
  } else out[path] = scalar(value);
  return out;
}

function collect(result: unknown): Tables {
  const tables: Tables = { timeline: [], geo: [], related_queries: [], related_topics: [], metadata: [], errors: [], unprocessed: [] };
  const top = obj(result);
  const metadata = (value: unknown, context: Row, prefix = '') => {
    for (const [path, valueAtPath] of Object.entries(flatten(value, prefix))) tables.metadata.push({ ...context, path, value: valueAtPath });
  };
  const items = Array.isArray(top.results) ? top.results : [result];
  if (Array.isArray(top.results)) {
    const { results: _results, ...summary } = top;
    metadata(summary, { resultIndex: null }, 'batch');
  }
  items.forEach((item, position) => {
    const envelope = obj(item);
    const response = Array.isArray(top.results) ? obj(envelope.result ?? envelope) : envelope;
    const input = obj(response.input ?? envelope.input);
    const queries = list(input.queries);
    const context: Row = {
      resultIndex: scalar(envelope.index ?? position), status: scalar(envelope.status ?? response.status),
      fetchedAt: scalar(obj(response.meta).fetchedAt),
    };
    if (context.status === 'unprocessed') tables.unprocessed.push({ ...context, ...flatten(envelope) });
    else if (context.status === 'error' || envelope.error != null) tables.errors.push({ ...context, ...flatten(envelope) });
    const { data: _data, ...rest } = response;
    metadata(rest, context);
    if (Array.isArray(top.results)) {
      const { result: _result, ...details } = envelope;
      metadata(details, context, 'item');
    }
    const data = obj(response.data);
    const keywordContext = (index: number): Row => ({ ...context, queryIndex: index, keyword: scalar(queries[index]) });
    const vectorRows = (item: unknown, section: Record<string, unknown>, table: 'timeline' | 'geo') => {
      const row = obj(item);
      const { values, formattedValues, hasData, ...fields } = row;
      const width = Math.max(queries.length, list(values).length);
      for (let index = 0; index < width; index++) {
        tables[table].push({ ...keywordContext(index), ...flatten(fields),
          valueMode: scalar(section.valueMode ?? 'RELATIVE'), value: scalar(list(values)[index]),
          formattedValue: scalar(list(formattedValues)[index]), hasData: scalar(list(hasData)[index]),
        });
      }
    };
    for (const [type, value] of Object.entries(data)) {
      if (value == null) { metadata(value, context, `data.${type}`); continue; }
      const section = obj(value);
      if (type === 'interestOverTime') {
        list(section.timeline).forEach(point => vectorRows(point, section, 'timeline'));
        list(section.averages).forEach((average, index) => tables.timeline.push({ ...keywordContext(index), metric: 'average', valueMode: 'RELATIVE', value: scalar(average) }));
        const { timeline: _timeline, averages: _averages, ...details } = section;
        metadata(details, context, `data.${type}`);
        if (section.averages === null) metadata(null, context, `data.${type}.averages`);
      } else if (type === 'interestBySubregion' || type === 'interestByCity' || type === 'interestByMetro') {
        list(section.rows).forEach(row => vectorRows({ dataType: type, resolution: section.resolution, ...obj(row) }, section, 'geo'));
        const { rows: _rows, ...details } = section;
        metadata(details, context, `data.${type}`);
      } else if (/^related(Queries|Topics)(ByQuery)?$/.test(type)) {
        const table = type.includes('Topics') ? 'related_topics' : 'related_queries';
        const addRelated = (related: unknown, index: number, keyword?: unknown) => {
          const relatedObj = obj(related);
          const relatedContext = { ...keywordContext(index), ...(keyword !== undefined ? { keyword: scalar(keyword) } : {}) };
          for (const metric of ['top', 'rising']) {
            if (relatedObj[metric] == null || list(relatedObj[metric]).length === 0) metadata(relatedObj[metric] ?? null, relatedContext, `data.${type}.${metric}`);
            list(relatedObj[metric]).forEach((entry, rank) => tables[table].push({
            ...relatedContext, metric, valueMode: metric === 'top' ? 'RELATIVE' : 'SOURCE_GROWTH', rank: rank + 1, ...flatten(entry),
          }));
          }
          const { top: _top, rising: _rising, ...details } = relatedObj;
          metadata(details, relatedContext, `data.${type}`);
          if (related === null) metadata(null, relatedContext, `data.${type}`);
        };
        if (!type.endsWith('ByQuery')) addRelated(value, 0);
        else if (Array.isArray(value)) value.forEach((entry, index) => {
          const e = obj(entry);
          addRelated(e.data ?? e.result ?? e.relatedQueries ?? e.relatedTopics ?? entry, index, e.query ?? e.keyword);
        });
        else Object.entries(section).forEach(([keyword, entry], index) => {
          const queryIndex = queries.indexOf(keyword);
          addRelated(entry, queryIndex >= 0 ? queryIndex : index, keyword);
        });
      } else metadata(value, context, `data.${type}`);
    }
  });
  return tables;
}

const headers = (rows: Row[]): string[] => [...new Set(rows.flatMap(row => Object.keys(row)))];
/** CSV consumers may remove whitespace before deciding whether a cell is a formula. */
const safeCsv = (value: Scalar | undefined): string => {
  const text = value == null ? '' : String(value);
  return typeof value === 'string' && /^[\s\uFEFF]*[=+@-]/u.test(text) ? `'${text}` : text;
};
const quote = (value: Scalar | undefined) => `"${safeCsv(value).replace(/"/g, '""')}"`;
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!));

function xml(value: unknown): string {
  if (value === null || value === undefined) return '<null/>';
  if (Array.isArray(value)) return `<array>${value.map(item => `<item>${xml(item)}</item>`).join('')}</array>`;
  if (typeof value === 'object') return `<object>${Object.entries(value).map(([key, item]) => `<field name="${escape(key).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')}">${xml(item)}</field>`).join('')}</object>`;
  // XML 1.0 cannot represent these controls. Input rejects them; remove any in upstream labels.
  const text = escape(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
  return `<${typeof value}>${text}</${typeof value}>`;
}

export async function formatGTrendsExport(result: unknown, format: GTrendsExportFormat): Promise<GTrendsExport> {
  if (format === 'json') return { filename: 'google-trends.json', contentType: 'application/json; charset=utf-8', body: JSON.stringify(result, null, 2) };
  const filename = `google-trends.${format}`;
  if (format === 'xml') return { filename, contentType: 'application/xml; charset=utf-8', body: `<?xml version="1.0" encoding="UTF-8"?><googleTrends>${xml(result)}</googleTrends>` };
  const tables = collect(result);
  if (format === 'csv') {
    const rows: Row[] = Object.entries(tables).flatMap(([type, entries]) => entries.map(row => {
      const { type: sourceType, ...fields } = row;
      return { type, ...fields, ...(sourceType !== undefined ? { sourceType } : {}) };
    }));
    const columns = headers(rows);
    const body = '\uFEFF' + [columns.map(quote).join(','), ...rows.map(row => columns.map(key => quote(row[key])).join(','))].join('\r\n') + '\r\n';
    return { filename, contentType: 'text/csv; charset=utf-8', body };
  }
  if (format === 'html') {
    const sections = Object.entries(tables).map(([name, rows]) => {
      const columns = headers(rows);
      return `<section><h2>${name}</h2><table><thead><tr>${columns.map(key => `<th>${escape(key)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(key => `<td${row[key] === null ? ' data-null="true"' : ''}>${escape(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
    }).join('');
    return { filename, contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Google Trends export</title><style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px;text-align:left}section{margin-bottom:24px;overflow:auto}td[data-null]{background:#eee}</style></head><body><h1>Google Trends export</h1>${sections}</body></html>` };
  }
  throw new Error('unsupported export format');
}
