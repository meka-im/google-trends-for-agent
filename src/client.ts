import * as core from './core.js';
import { createDefaultTransport, RateLimiter, Session, withRetry, type RateLimitOptions, type Transport } from './transport.js';
export interface TrendsResult {
  status: 'ok' | 'partial' | 'error';
  input?: Record<string, unknown>;
  data: Record<string, unknown>;
  error?: { code: string; message: string; retryAfterSec?: number };
  meta: { upstreamRequests: number; durationMs: number; warnings: string[] };
}
export interface ClientOptions extends RateLimitOptions { transport?: Transport; limiter?: RateLimiter }
export class TrendsClient {
  private readonly transport: Transport;
  private readonly limiter: RateLimiter;
  constructor(options: ClientOptions = {}) {
    this.transport = options.transport ?? createDefaultTransport();
    this.limiter = options.limiter ?? new RateLimiter(options);
  }
  async query(raw: unknown): Promise<TrendsResult> {
    const started = this.limiter.now();
    const session = new Session(this.transport, this.limiter);
    const data: Record<string, unknown> = {};
    const warnings: string[] = [];
    let input: core.GTrendsInput | undefined;
    const meta = () => ({ upstreamRequests: session.upstreamRequests, durationMs: this.limiter.now() - started, warnings });
    try {
      input = core.parseGTrendsInput(raw);
      const i = input;
      const request = (url: string, method = 'GET'): Promise<string> => withRetry(
        () => session.request({ url, method, timeoutMs: i.timeoutMs ?? 8000, headers: {
          accept: 'application/json, text/plain, */*', 'accept-language': core.acceptLanguage(i.locale),
          'user-agent': 'Mozilla/5.0', referer: core.refererUrl(i),
        } }),
        { maxRetries: i.maxRetries, sleep: this.limiter.sleep },
      );
      const explore = async (v: core.GTrendsInput) => core.selectWidgets(core.stripXssi(await request(core.exploreUrl(v))), v);
      await request(core.BOOTSTRAP_URL, 'HEAD');
      const widgets = await explore(i);
      const widget = async (w: core.Widget, path: core.WidgetPath, parse: (j: unknown) => unknown, req = w.request) => parse(core.stripXssi(await request(core.widgetUrl(path, req, w.token, i))));
      let firstFailure: unknown;
      for (const type of i.dataTypes) {
        try {
          if (type === 'interestOverTime') data[type] = await widget(widgets.timeseries!, 'multiline', j => core.parseTimeline(j, i.queries.length));
          else if (type.startsWith('interestBy')) {
            const w = widgets.geoMap!;
            const req = type === 'interestByCity' ? core.cityRequest(w) : type === 'interestByMetro' ? { ...w.request, resolution: 'DMA', includeLowSearchVolumeGeos: true } : w.request;
            const value = await widget(w, 'comparedgeo', j => core.parseGeo(j, i.queries.length, req), req) as core.GeoResult<core.GeoRow | core.CityRow>;
            data[type] = value;
            if (type === 'interestByCity' && !value.rows.length && value.omittedNoDataRows) { data[type] = null; warnings.push(`${type}: no_city_data`); }
          } else {
            const topics = type === 'relatedTopics';
            const entries: unknown[] = [];
            const key = i.queries.length > 1 ? `${type}ByQuery` : type;
            if (i.queries.length > 1) data[key] = entries;
            for (const [index, query] of i.queries.entries()) {
              try {
                let w: core.Widget;
                if (topics) w = i.queries.length > 1 ? (await explore({ ...i, queries: [query], dataTypes: ['relatedTopics'] })).relatedTopics! : widgets.relatedTopics!;
                else w = widgets.relatedQueries ?? widgets.relatedQueriesByQuery![index];
                const value = await widget(w, 'relatedsearches', j => topics ? core.parseRelatedTopics(j, w.request.metric) : core.parseRelated(j, w.request.metric));
                entries.push({ query, ...(value as object) });
                if (i.queries.length === 1) data[key] = value;
              } catch (e) {
                if (i.queries.length === 1) throw e;
                if (!(e instanceof core.GTrendsError) && !(e instanceof core.ProtocolMismatch)) throw e;
                firstFailure ??= e;
                entries.push({ query, top: null, rising: null });
                warnings.push(`${type}[queryIndex=${index}]: ${e instanceof core.GTrendsError ? e.code : 'TRENDS_PROTOCOL_CHANGED'}`);
                if (e instanceof core.GTrendsError && ['BLOCKED', 'RATE_LIMITED'].includes(e.code)) throw e;
              }
            }
          }
        } catch (e) {
          if (!(e instanceof core.GTrendsError) && !(e instanceof core.ProtocolMismatch)) throw e;
          if (e instanceof core.GTrendsError && ['BLOCKED', 'RATE_LIMITED'].includes(e.code)) throw e;
          firstFailure ??= e;
          data[type] = null;
          warnings.push(`${type}: ${e instanceof core.GTrendsError ? e.code : 'TRENDS_PROTOCOL_CHANGED'}`);
        }
      }
      if (firstFailure && Object.values(data).every(v => v === null || Array.isArray(v) && v.every(entry => entry.top === null))) throw firstFailure;
      return { status: warnings.length ? 'partial' : 'ok', input: core.publicInput(i), data, meta: meta() };
    } catch (e) {
      const error = e instanceof core.GTrendsError ? e : new core.GTrendsError('TRENDS_PROTOCOL_CHANGED', 'Google Trends returned an unexpected response shape; the public endpoints may have changed. Retry later, and check for a newer gtfa if it persists.');
      return { status: 'error', ...(input ? { input: core.publicInput(input) } : {}), data, error: { code: error.code, message: error.message, ...(error.retryAfterSec != null ? { retryAfterSec: error.retryAfterSec } : {}) }, meta: meta() };
    }
  }
}
export const runGTrendsQuery = (raw: unknown, options: ClientOptions = {}) => new TrendsClient(options).query(raw);
