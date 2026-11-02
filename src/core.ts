/** Input validation, endpoint construction, and strict response parsers. */
export const DATA_TYPES = ['interestByCity', 'interestByMetro', 'interestBySubregion', 'interestOverTime', 'relatedQueries', 'relatedTopics'] as const;
export type GTrendsDataType = (typeof DATA_TYPES)[number];

export const TIME_RANGES = ['now 1-H', 'now 4-H', 'now 1-d', 'now 7-d', 'today 1-m', 'today 3-m', 'today 12-m', 'today 5-y', 'all'] as const;
export type GTrendsTimeRange = (typeof TIME_RANGES)[number];

export type GTrendsSearchType = 'web' | 'images' | 'news' | 'youtube' | 'shopping';

export const SEARCH_TYPE_PROPERTY: Record<GTrendsSearchType, string> = {
  web: '', images: 'images', news: 'news', youtube: 'youtube', shopping: 'froogle',
};

export const OPEN_SEARCH_TYPES: readonly GTrendsSearchType[] = ['web', 'images', 'news', 'youtube', 'shopping'];

export const LOCALES: readonly string[] = ['en-US', 'en-GB', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es', 'pt-BR'];

const COUNTRIES = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS ' +
  'BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO ' +
  'FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG ' +
  'KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY ' +
  'MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI ' +
  'SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU ' +
  'WF WS YE YT ZA ZM ZW XK').split(' '));

const GEO_RE = /^([A-Z]{2})(-[A-Z0-9]{1,3}(-[0-9]{3})?)?$/;

export const MAX_QUERIES = 5;
export const MAX_QUERY_CHARS = 100;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_CATEGORY = 99_999;
const FIELDS = new Set(['queries', 'geo', 'timeRange', 'startDate', 'endDate', 'category', 'searchType', 'locale', 'timezoneOffsetMinutes', 'dataTypes', 'timeoutMs', 'maxRetries']);
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EARLIEST_DATE = '2004-01-01';

export interface GTrendsInput {
  timeoutMs?: number;
  maxRetries: number;
  queries: string[];
  geo: string;
  
  /** Use a relative range or a start/end date pair. */
  timeRange: GTrendsTimeRange | null;
  startDate: string | null;
  endDate: string | null;
  category: number;
  searchType: GTrendsSearchType;
  locale: string;
  
  /** Minutes east of UTC; the upstream tz parameter has the opposite sign. */
  timezoneOffsetMinutes: number;
  
  dataTypes: GTrendsDataType[];
}

export type GTrendsErrorCode =
  | 'INVALID_INPUT' | 'INVALID_COMBINATION' | 'REQUEST_TOO_LARGE' | 'RATE_LIMITED'
  | 'NETWORK_ERROR' | 'BLOCKED' | 'TRENDS_PROTOCOL_CHANGED' | 'TRENDS_TEMPORARILY_UNAVAILABLE' | 'TRENDS_TIMEOUT';

export const ERROR_HTTP: Record<GTrendsErrorCode, number> = {
  NETWORK_ERROR: 502, BLOCKED: 429, INVALID_INPUT: 400, INVALID_COMBINATION: 400, REQUEST_TOO_LARGE: 413, RATE_LIMITED: 429,
  TRENDS_PROTOCOL_CHANGED: 502, TRENDS_TEMPORARILY_UNAVAILABLE: 503, TRENDS_TIMEOUT: 504,
};

export class GTrendsError extends Error {
  constructor(readonly code: GTrendsErrorCode, message: string, readonly retryAfterSec?: number) {
    super(message);
  }
  get httpStatus(): number { return ERROR_HTTP[this.code]; }
  toBody(): { status: 'error'; code: GTrendsErrorCode; error: string; retryAfterSec?: number } {
    return { status: 'error', code: this.code, error: this.message, ...(this.retryAfterSec != null ? { retryAfterSec: this.retryAfterSec } : {}) };
  }
}

const bad = (message: string) => new GTrendsError('INVALID_INPUT', message);
const combo = (message: string) => new GTrendsError('INVALID_COMBINATION', message);
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

function validDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function parseGTrendsInput(raw: unknown, now: Date = new Date()): GTrendsInput {
  if (!isObj(raw)) throw bad('request body must be a JSON object');
  for (const k of Object.keys(raw)) {
    
    if (!FIELDS.has(k)) throw bad(`unknown field: ${k.slice(0, 40)}`);
  }

  if (!Array.isArray(raw.queries)) throw bad('queries must be an array of 1-5 strings');
  const queries: string[] = [];
  for (const q of raw.queries) {
    if (typeof q !== 'string') throw bad('queries must be an array of 1-5 strings');
    const t = q.trim();
    const len = [...t].length;
    if (len < 1 || len > MAX_QUERY_CHARS) throw bad(`each query must be 1-${MAX_QUERY_CHARS} characters after trimming`);
    if (CONTROL_RE.test(t)) throw bad('queries must not contain control characters');
    if (!queries.includes(t)) queries.push(t);
  }
  if (queries.length < 1 || queries.length > MAX_QUERIES) throw bad(`queries must contain 1-${MAX_QUERIES} distinct strings`);

  let geo = '';
  if (raw.geo !== undefined) {
    if (typeof raw.geo !== 'string') throw bad('geo must be a string');
    geo = raw.geo.trim().toUpperCase();
    if (geo) {
      const m = GEO_RE.exec(geo);
      if (!m || !COUNTRIES.has(m[1])) throw bad('geo must be empty, an ISO 3166-1 alpha-2 country code, or a region code like US-CA');
    }
  }

  const hasRange = raw.timeRange !== undefined;
  const hasDates = raw.startDate !== undefined || raw.endDate !== undefined;
  if (hasRange && hasDates) throw combo('use either timeRange or startDate/endDate, not both');
  let timeRange: GTrendsTimeRange | null = null;
  let startDate: string | null = null;
  let endDate: string | null = null;
  if (hasDates) {
    if (typeof raw.startDate !== 'string' || typeof raw.endDate !== 'string') throw bad('startDate and endDate must both be given as YYYY-MM-DD');
    if (!validDate(raw.startDate) || !validDate(raw.endDate)) throw bad('startDate and endDate must be valid dates in YYYY-MM-DD');
    startDate = raw.startDate;
    endDate = raw.endDate;
    if (startDate < EARLIEST_DATE) throw bad(`startDate must be on or after ${EARLIEST_DATE}`);
    if (endDate > utcDay(now)) throw bad('endDate must not be in the future');
    if (startDate > endDate) throw bad('startDate must not be after endDate');
  } else if (hasRange) {
    if (typeof raw.timeRange !== 'string' || !(TIME_RANGES as readonly string[]).includes(raw.timeRange)) {
      throw bad(`timeRange must be one of: ${TIME_RANGES.join(', ')}`);
    }
    timeRange = raw.timeRange as GTrendsTimeRange;
  } else {
    timeRange = 'today 12-m';
  }

  let category = 0;
  if (raw.category !== undefined) {
    if (!Number.isSafeInteger(raw.category) || raw.category < 0 || raw.category > MAX_CATEGORY) throw bad('category must be a non-negative integer');
    category = raw.category;
  }

  let searchType: GTrendsSearchType = 'web';
  if (raw.searchType !== undefined) {
    if (typeof raw.searchType !== 'string' || !(OPEN_SEARCH_TYPES as readonly string[]).includes(raw.searchType)) {
      throw bad(`searchType must be one of: ${OPEN_SEARCH_TYPES.join(', ')}`);
    }
    searchType = raw.searchType as GTrendsSearchType;
  }

  let locale = 'en-US';
  if (raw.locale !== undefined) {
    const hit = typeof raw.locale === 'string' ? LOCALES.find((l) => l.toLowerCase() === raw.locale.trim().toLowerCase()) : undefined;
    if (!hit) throw bad(`locale must be one of: ${LOCALES.join(', ')}`);
    locale = hit;
  }

  let timezoneOffsetMinutes = 0;
  if (raw.timezoneOffsetMinutes !== undefined) {
    const tz = raw.timezoneOffsetMinutes;
    if (!Number.isSafeInteger(tz) || tz < -840 || tz > 840) throw bad('timezoneOffsetMinutes must be an integer between -840 and 840');
    timezoneOffsetMinutes = tz;
  }

  let dataTypes: GTrendsDataType[] = ['interestOverTime'];
  if (raw.dataTypes !== undefined) {
    if (!Array.isArray(raw.dataTypes) || raw.dataTypes.length === 0 || raw.dataTypes.length > 16) throw bad('dataTypes must be a non-empty array');
    const set = new Set<GTrendsDataType>();
    for (const t of raw.dataTypes) {
      if (typeof t !== 'string' || !(DATA_TYPES as readonly string[]).includes(t)) throw bad(`dataTypes items must be among: ${DATA_TYPES.join(', ')}`);
      set.add(t as GTrendsDataType);
    }
    dataTypes = [...set].sort();
  }

  if (dataTypes.includes('interestByMetro') && geo !== 'US' && !geo.startsWith('US-')) throw combo('interestByMetro requires US geo');

  if (raw.timeoutMs !== undefined && (!Number.isSafeInteger(raw.timeoutMs) || raw.timeoutMs < 1000 || raw.timeoutMs > 60000)) throw bad('timeoutMs must be an integer between 1000 and 60000');
  const maxRetries = raw.maxRetries ?? 1;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) throw bad('maxRetries must be an integer between 0 and 2');
  return { ...(raw.timeoutMs !== undefined ? { timeoutMs: raw.timeoutMs } : {}), maxRetries, queries, geo, timeRange, startDate, endDate, category, searchType, locale, timezoneOffsetMinutes, dataTypes };
}

export function publicInput(input: GTrendsInput): Record<string, unknown> {
  const { timeRange, startDate, endDate, ...rest } = input;
  return {
    queries: rest.queries, geo: rest.geo,
    ...(rest.timeoutMs !== undefined ? { timeoutMs: rest.timeoutMs } : {}), maxRetries: rest.maxRetries,
    ...(timeRange ? { timeRange } : { startDate, endDate }),
    category: rest.category, searchType: rest.searchType, locale: rest.locale,
    timezoneOffsetMinutes: rest.timezoneOffsetMinutes, dataTypes: rest.dataTypes,
  };
}

export function canonicalJson(input: GTrendsInput): string {
  return JSON.stringify({
    queries: input.queries,
    dataTypes: input.dataTypes,
    geo: input.geo,
    time: input.timeRange ?? { startDate: input.startDate, endDate: input.endDate },
    category: input.category,
    searchType: input.searchType,
    locale: input.locale,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
  });
}

export async function cacheKey(input: GTrendsInput): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(input)));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `gtrends:v2:${hex}`;
}

const RANGE_TTL_SEC: Record<GTrendsTimeRange, number> = {
  'now 1-H': 300, 'now 4-H': 600, 'now 1-d': 900, 'now 7-d': 3600,
  'today 1-m': 3 * 3600, 'today 3-m': 6 * 3600,
  'today 12-m': 86_400, 'today 5-y': 86_400, all: 86_400,
};

export const EMPTY_TTL_CAP_SEC = 1800;

export function cacheTtlSec(input: GTrendsInput, hasLegitEmpty: boolean, now: Date = new Date()): number {
  let ttl: number;
  if (input.timeRange) {
    ttl = RANGE_TTL_SEC[input.timeRange];
  } else {
    
    const span = dayDiff(input.startDate!, input.endDate!);
    if (dayDiff(input.endDate!, utcDay(now)) > 3) ttl = 86_400;
    else if (span <= 7) ttl = 3600;
    else if (span <= 31) ttl = 3 * 3600;
    else if (span <= 92) ttl = 6 * 3600;
    else ttl = 86_400;
  }
  return hasLegitEmpty ? Math.min(ttl, EMPTY_TTL_CAP_SEC) : ttl;
}

export const ORIGIN = 'https://trends.google.com';
export const BOOTSTRAP_URL = `${ORIGIN}/trends/?geo=US`;

export const googleTz = (input: GTrendsInput) => String(-input.timezoneOffsetMinutes || 0);
export const timeParam = (input: GTrendsInput) => input.timeRange ?? `${input.startDate} ${input.endDate}`;

export function exploreUrl(input: GTrendsInput): string {
  const req = {
    comparisonItem: input.queries.map((keyword) => ({ keyword, geo: input.geo, time: timeParam(input) })),
    category: input.category,
    property: SEARCH_TYPE_PROPERTY[input.searchType],
  };
  return `${ORIGIN}/trends/api/explore?hl=${encodeURIComponent(input.locale)}&tz=${googleTz(input)}&req=${encodeURIComponent(JSON.stringify(req))}`;
}

export type WidgetPath = 'multiline' | 'comparedgeo' | 'relatedsearches';
export function widgetUrl(path: WidgetPath, request: unknown, token: string, input: GTrendsInput): string {
  return `${ORIGIN}/trends/api/widgetdata/${path}?hl=${encodeURIComponent(input.locale)}&tz=${googleTz(input)}` +
    `&req=${encodeURIComponent(JSON.stringify(request))}&token=${encodeURIComponent(token)}`;
}

export function refererUrl(input: GTrendsInput): string {
  const p = new URLSearchParams();
  if (input.timeRange) p.set('date', input.timeRange); else p.set('date', timeParam(input));
  if (input.geo) p.set('geo', input.geo);
  if (input.category) p.set('cat', String(input.category));
  if (SEARCH_TYPE_PROPERTY[input.searchType]) p.set('gprop', SEARCH_TYPE_PROPERTY[input.searchType]);
  p.set('q', input.queries.join(','));
  p.set('hl', input.locale);
  return `${ORIGIN}/trends/explore?${p.toString()}`;
}

export function acceptLanguage(locale: string): string {
  const base = locale.split('-')[0];
  const parts = [locale];
  if (base !== locale) parts.push(`${base};q=0.9`);
  if (base !== 'en') parts.push('en;q=0.8');
  return parts.join(',');
}

export class ProtocolMismatch extends Error {}
const mismatch = (what: string) => new ProtocolMismatch(what);

export function stripXssi(body: unknown): unknown {
  if (typeof body !== 'string' || !body.startsWith(")]}'")) throw mismatch('missing anti-XSSI prefix');
  const rest = body.slice(4).replace(/^,?\s*/, '');
  try { return JSON.parse(rest); } catch { throw mismatch('response is not JSON'); }
}

export interface Widget { id: string; request: Record<string, any>; token: string }
export interface SelectedWidgets { timeseries?: Widget; geoMap?: Widget; relatedQueries?: Widget; relatedQueriesByQuery?: Widget[]; relatedTopics?: Widget }

const normKw = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

function keywordsOf(items: unknown, path: (it: any) => unknown): string[] | null {
  if (!Array.isArray(items)) return null;
  const out: string[] = [];
  for (const it of items) {
    const v = path(it);
    if (typeof v !== 'string') return null;
    out.push(v);
  }
  return out;
}

function checkComparison(w: Widget, input: GTrendsInput, kw: (it: any) => unknown): void {
  const items = w.request.comparisonItem;
  if (!Array.isArray(items) || items.length !== input.queries.length) throw mismatch(`${w.id} comparisonItem width`);
  const kws = keywordsOf(items, kw);
  
  if (!kws || kws.some((k, i) => normKw(k) !== normKw(input.queries[i]))) throw mismatch(`${w.id} keyword order`);
  const opts = w.request.requestOptions;
  if (!isObj(opts) || opts.property !== SEARCH_TYPE_PROPERTY[input.searchType] || opts.category !== input.category) {
    throw mismatch(`${w.id} requestOptions`);
  }
}

export function selectWidgets(explore: unknown, input: GTrendsInput): SelectedWidgets {
  if (!isObj(explore) || !Array.isArray(explore.widgets)) throw mismatch('explore without widgets');
  const byId = new Map<string, any>();
  for (const w of explore.widgets) if (isObj(w) && typeof w.id === 'string') byId.set(w.id, w);
  const take = (id: string): Widget => {
    const w = byId.get(id);
    if (!w) throw mismatch(`widget ${id} missing`);
    if (!isObj(w.request) || typeof w.token !== 'string' || !w.token) throw mismatch(`widget ${id} without request/token`);
    return { id, request: w.request, token: w.token };
  };
  const need = new Set(input.dataTypes);
  const out: SelectedWidgets = {};
  if (need.has('interestOverTime')) {
    out.timeseries = take('TIMESERIES');
    checkComparison(out.timeseries, input, (it) => it?.complexKeywordsRestriction?.keyword?.[0]?.value);
  }
  if (need.has('interestBySubregion') || need.has('interestByCity') || need.has('interestByMetro')) {
    out.geoMap = take('GEO_MAP');
    checkComparison(out.geoMap, input, (it) => it?.complexKeywordsRestriction?.keyword?.[0]?.value);
    if (typeof out.geoMap.request.resolution !== 'string') throw mismatch('GEO_MAP resolution');
  }
  const related = (id: string, query: string): Widget => {
    const w = take(id), r = w.request;
    const kw = r.restriction?.complexKeywordsRestriction?.keyword?.[0]?.value;
    if (typeof kw !== 'string' || normKw(kw) !== normKw(query)) throw mismatch(`${id} keyword`);
    if (!Array.isArray(r.metric) || r.metric.length !== 2 || !r.metric.includes('TOP') || !r.metric.includes('RISING')) throw mismatch(`${id} metric`);
    if (!isObj(r.requestOptions) || r.requestOptions.property !== SEARCH_TYPE_PROPERTY[input.searchType] || r.requestOptions.category !== input.category) throw mismatch(`${id} requestOptions`);
    return w;
  };
  if (need.has('relatedQueries')) {
    if (input.queries.length === 1) out.relatedQueries = related('RELATED_QUERIES', input.queries[0]);
    else out.relatedQueriesByQuery = input.queries.map((q, i) => related(`RELATED_QUERIES_${i}`, q));
  }
  if (need.has('relatedTopics') && input.queries.length === 1) out.relatedTopics = related('RELATED_TOPICS', input.queries[0]);
  return out;
}

export const cityRequest = (geoMap: Widget) => ({ ...geoMap.request, resolution: 'CITY', includeLowSearchVolumeGeos: true });

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const numArr = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(isNum);
const strArr = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every(isStr);
const boolArr = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((b) => typeof b === 'boolean');

const plainSpaces = (s: string) => s.replace(/[\u2009\u202f\u00a0]/g, ' ');

export interface TimelinePoint {
  
  time: string;
  formattedTime: string;
  values: number[];
  formattedValues: string[];
  hasData: boolean[];
  
  isPartial: boolean;
}
export interface InterestOverTime { timeline: TimelinePoint[]; averages: number[] | null }

export function parseTimeline(json: unknown, width: number): InterestOverTime {
  const d = isObj(json) ? json.default : null;
  if (!isObj(d) || !Array.isArray(d.timelineData)) throw mismatch('multiline without timelineData');
  const timeline = d.timelineData.map((p: any): TimelinePoint => {
    if (!isObj(p) || !isStr(p.time) || !/^\d{9,11}$/.test(p.time) || !isStr(p.formattedTime)) throw mismatch('timeline point');
    if (!numArr(p.value, width) || !strArr(p.formattedValue, width) || !boolArr(p.hasData, width)) throw mismatch('timeline width');
    if (p.value.some((v: number) => v < 0 || v > 100)) throw mismatch('timeline value range');
    if (p.isPartial !== undefined && typeof p.isPartial !== 'boolean') throw mismatch('timeline isPartial');
    return {
      time: new Date(Number(p.time) * 1000).toISOString(),
      formattedTime: plainSpaces(p.formattedTime),
      values: p.value, formattedValues: p.formattedValue, hasData: p.hasData,
      isPartial: p.isPartial === true,
    };
  });
  
  let averages: number[] | null = null;
  if (d.averages !== undefined) {
    if (!Array.isArray(d.averages)) throw mismatch('averages');
    if (d.averages.length === width && width > 1 && numArr(d.averages, width)) averages = d.averages;
    else if (d.averages.length !== 0) throw mismatch('averages width');
  }
  return { timeline, averages };
}

export type GeoResolution = 'COUNTRY' | 'REGION' | 'DMA' | 'CITY';
const RESOLUTIONS: readonly string[] = ['COUNTRY', 'REGION', 'DMA', 'CITY'];

export interface GeoRow { geoCode: string; geoName: string; values: number[]; formattedValues: string[]; hasData: boolean[] }
export interface CityRow { geoName: string; coordinates: { lat: number; lng: number }; values: number[]; formattedValues: string[]; hasData: boolean[] }
export interface GeoResult<R> {
  resolution: GeoResolution;
  
  valueMode: 'RELATIVE' | 'PERCENTAGES';
  rows: R[];
  
  omittedNoDataRows: number;
}

export function parseGeo(json: unknown, width: number, request: Record<string, any>): GeoResult<GeoRow | CityRow> {
  const resolution = request.resolution;
  if (!RESOLUTIONS.includes(resolution)) throw mismatch('geo resolution');
  const d = isObj(json) ? json.default : null;
  if (!isObj(d) || !Array.isArray(d.geoMapData)) throw mismatch('comparedgeo without geoMapData');
  const rows: Array<GeoRow | CityRow> = [];
  let omitted = 0;
  for (const r of d.geoMapData) {
    if (!isObj(r) || !isStr(r.geoName)) throw mismatch('geo row');
    if (!numArr(r.value, width) || !strArr(r.formattedValue, width) || !boolArr(r.hasData, width)) throw mismatch('geo width');
    const base = { values: r.value as number[], formattedValues: r.formattedValue as string[], hasData: r.hasData as boolean[] };
    let row: GeoRow | CityRow;
    if (resolution === 'CITY') {
      
      const c = r.coordinates;
      if (!isObj(c) || !isNum(c.lat) || !isNum(c.lng) || r.geoCode !== undefined) throw mismatch('city row');
      row = { geoName: r.geoName, coordinates: { lat: c.lat, lng: c.lng }, ...base };
    } else {
      if (!isStr(r.geoCode) || !r.geoCode) throw mismatch('geo row geoCode');
      row = { geoCode: r.geoCode, geoName: r.geoName, ...base };
    }
    if (base.hasData.some(Boolean)) rows.push(row);
    else omitted++;
  }
  return { resolution, valueMode: request.dataMode === 'PERCENTAGES' ? 'PERCENTAGES' : 'RELATIVE', rows, omittedNoDataRows: omitted };
}

export interface RelatedQuery { query: string; value: number; formattedValue: string }
export interface RelatedQueries { top: RelatedQuery[]; rising: RelatedQuery[] }

export function parseRelated(json: unknown, metric: string[]): RelatedQueries {
  const d = isObj(json) ? json.default : null;
  if (!isObj(d) || !Array.isArray(d.rankedList) || d.rankedList.length !== metric.length) throw mismatch('relatedsearches rankedList');
  const list = (m: string): RelatedQuery[] => {
    const ranked = d.rankedList[metric.indexOf(m)];
    if (!isObj(ranked) || !Array.isArray(ranked.rankedKeyword)) throw mismatch('rankedKeyword');
    return ranked.rankedKeyword.map((k: any) => {
      if (!isObj(k) || !isStr(k.query) || !isNum(k.value) || !isStr(k.formattedValue)) throw mismatch('related item');
      return { query: k.query, value: k.value, formattedValue: k.formattedValue };
    });
  };
  return { top: list('TOP'), rising: list('RISING') };
}

export interface RelatedTopic { mid: string; title: string; type: string; value: number; formattedValue: string; link: string }
export interface RelatedTopics { top: RelatedTopic[]; rising: RelatedTopic[] }
export interface RelatedByQuery<T> { query: string; top: T[] | null; rising: T[] | null }
export function safeRelatedLink(raw: unknown): string {
  if (!isStr(raw)) throw mismatch('related link');
  let u: URL;
  try { u = new URL(raw, ORIGIN); } catch { throw mismatch('related link'); }
  if (u.origin !== ORIGIN || u.username || u.password || u.pathname !== '/trends/explore') throw mismatch('related link origin');
  return u.href;
}
export function parseRelatedTopics(json: unknown, metric: string[]): RelatedTopics {
  const d = isObj(json) ? json.default : null;
  if (!isObj(d) || !Array.isArray(d.rankedList) || !metric.includes('TOP') || !metric.includes('RISING')) throw mismatch('related topics rankedList');

  if (d.rankedList.length === 0) return { top: [], rising: [] };
  if (d.rankedList.length !== metric.length) throw mismatch('related topics rankedList');
  const list = (m: string): RelatedTopic[] => {
    const ranked = d.rankedList[metric.indexOf(m)];
    if (!isObj(ranked) || !Array.isArray(ranked.rankedKeyword)) throw mismatch('topic rankedKeyword');
    return ranked.rankedKeyword.map((k: any) => {
      const t = k?.topic;
      if (!isObj(t) || !isStr(t.mid) || !/^\/[mg]\/[A-Za-z0-9_]+$/.test(t.mid) || !isStr(t.title) || !isStr(t.type) || !isNum(k.value) || !isStr(k.formattedValue)) throw mismatch('related topic item');
      return { mid: t.mid, title: t.title, type: t.type, value: k.value, formattedValue: k.formattedValue, link: safeRelatedLink(k.link) };
    });
  };
  return { top: list('TOP'), rising: list('RISING') };
}

