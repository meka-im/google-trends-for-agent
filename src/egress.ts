import { GTrendsError } from './core.js';
import { ApifyProxySession, createRotatingTransport, type ProxyUrlProvider } from './actor-proxy.js';
import { createDefaultTransport, type Transport } from './transport.js';

export type EgressMode = 'local' | 'apify';

export interface ApifyProxyUrlProviderOptions {
  /** Apify API token; defaults to APIFY_TOKEN. */
  token?: string;
  /** Apify Proxy password; defaults to APIFY_PROXY_PASSWORD. */
  proxyPassword?: string;
  /** Residential proxy country; defaults to US. */
  country?: string;
  /** Fetch implementation used for the one-time password lookup. */
  fetch?: typeof globalThis.fetch;
}

const APIFY_PROXY_HOST = 'proxy.apify.com:8000';
const APIFY_PROXY_GROUPS = 'RESIDENTIAL';
const APIFY_ME_URL = 'https://api.apify.com/v2/users/me';

/** Build the Apify Residential proxy URL without touching process.env. */
export class ApifyProxyUrlProvider implements ProxyUrlProvider {
  private passwordPromise: Promise<string> | undefined;

  constructor(private readonly options: ApifyProxyUrlProviderOptions = {}) {}

  private token(): string {
    return (this.options.token?.trim() || process.env.APIFY_TOKEN?.trim() || '');
  }

  private configuredPassword(): string {
    return (this.options.proxyPassword?.trim() || process.env.APIFY_PROXY_PASSWORD?.trim() || '');
  }

  private get fetch(): typeof globalThis.fetch {
    return this.options.fetch ?? globalThis.fetch;
  }

  private password(): Promise<string> {
    const configured = this.configuredPassword();
    if (configured) return Promise.resolve(configured);
    this.passwordPromise ??= this.fetchPassword().catch(error => {
      // Do not cache a failure: a fixed token can succeed on the next rotation.
      this.passwordPromise = undefined;
      throw error;
    });
    return this.passwordPromise;
  }

  private async fetchPassword(): Promise<string> {
    const token = this.token();
    if (!token) {
      throw new GTrendsError('INVALID_INPUT', 'apify egress requires APIFY_PROXY_PASSWORD or APIFY_TOKEN. Set APIFY_TOKEN so gtfa can read the Apify proxy password, or switch egress to local.');
    }
    let response: Response;
    try {
      response = await this.fetch(APIFY_ME_URL, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new GTrendsError('NETWORK_ERROR', 'Could not reach the Apify API to read the proxy password. Check connectivity, or set APIFY_PROXY_PASSWORD directly.');
    }
    if (!response.ok) {
      throw new GTrendsError('INVALID_INPUT', `Apify API returned HTTP ${response.status} while reading the proxy password. Check APIFY_TOKEN and proxy access.`);
    }
    let body: unknown;
    try { body = await response.json(); }
    catch {
      throw new GTrendsError('INVALID_INPUT', 'Apify API returned a non-JSON response while reading the proxy password. Check APIFY_TOKEN.');
    }
    const password = (body as { data?: { proxy?: { password?: unknown } } } | null)?.data?.proxy?.password;
    if (typeof password !== 'string' || !password.trim()) {
      throw new GTrendsError('INVALID_INPUT', 'Apify API did not return data.proxy.password. Check APIFY_TOKEN and that Apify Proxy is available to this account.');
    }
    return password.trim();
  }

  async newUrl(sessionId?: string | number): Promise<string> {
    const password = await this.password();
    const country = (this.options.country ?? 'US').trim().toUpperCase() || 'US';
    const session = sessionId === undefined || sessionId === null || String(sessionId).trim() === ''
      ? ''
      : `,session-${encodeURIComponent(String(sessionId).trim())}`;
    return `http://groups-${APIFY_PROXY_GROUPS}${session},country-${encodeURIComponent(country)}:${encodeURIComponent(password)}@${APIFY_PROXY_HOST}`;
  }
}

export interface EgressOptions {
  /** `local` sends requests from this machine (HTTPS_PROXY still honored); `apify` uses Apify Residential. */
  egress?: EgressMode;
  /** Apify API token; defaults to APIFY_TOKEN. */
  apifyToken?: string;
  /** Apify Proxy password; defaults to APIFY_PROXY_PASSWORD. */
  apifyProxyPassword?: string;
  /** Residential proxy country; defaults to US. */
  apifyProxyCountry?: string;
  /** Fetch implementation used for the one-time password lookup. */
  fetch?: typeof globalThis.fetch;
  /** Deterministic session-id factory, mainly for tests. */
  sessionId?: (counter: number) => string;
  /** Build the proxy-aware transport from an explicit URL; defaults to createDefaultTransport. */
  createTransport?: (proxyUrl: string) => Transport;
}

/**
 * Create the tool egress transport. Apify credentials are resolved on the
 * first request, never at boot, so a missing token becomes a normal tool error
 * envelope instead of a plugin startup failure.
 */
export function createEgressTransport(options: EgressOptions = {}): Transport {
  const mode = options.egress ?? 'local';
  if (mode === 'local') return createDefaultTransport();
  if (mode !== 'apify') throw new RangeError(`unsupported egress "${String(mode)}"; use "local" or "apify"`);

  const provider = new ApifyProxyUrlProvider({
    token: options.apifyToken,
    proxyPassword: options.apifyProxyPassword,
    country: options.apifyProxyCountry,
    fetch: options.fetch,
  });
  const session = new ApifyProxySession(provider, options.sessionId);
  const createTransport = options.createTransport ?? (url => createDefaultTransport({ HTTPS_PROXY: url }));
  let inner: Transport | undefined;
  let initializing: Promise<void> | undefined;

  const ensure = async () => {
    initializing ??= (async () => {
      const url = await session.rotate();
      if (!url) throw new GTrendsError('INVALID_INPUT', 'Apify proxy returned no URL. Check your Apify proxy access and egress configuration.');
      inner = createRotatingTransport(session, { createTransport });
    })().catch(error => {
      initializing = undefined;
      throw error;
    });
    await initializing;
  };

  return async request => {
    await ensure();
    return inner!(request);
  };
}
