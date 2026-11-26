import {
  createDefaultTransport,
  errorLabel,
  isChallengeResponse,
  isRateLimitResponse,
  type Transport,
} from './transport.js';

/** Default proxy configuration exposed by the Actor input schema. */
export const ACTOR_PROXY_DEFAULTS = {
  useApifyProxy: true,
  apifyProxyGroups: ['RESIDENTIAL'],
  apifyProxyCountry: 'US',
} as const;

export type ActorProxyInput = Record<string, unknown>;

/** Use the user's proxy choice when present; otherwise default to US residential. */
export function actorProxyInput(value: unknown): ActorProxyInput {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as ActorProxyInput;
  return { ...ACTOR_PROXY_DEFAULTS, apifyProxyGroups: [...ACTOR_PROXY_DEFAULTS.apifyProxyGroups] };
}

export interface ProxyUrlProvider {
  newUrl(sessionId?: string | number): Promise<string | undefined>;
}

export interface ResolvedActorProxy {
  session: ApifyProxySession | null;
  mode: 'requested' | 'fallback-auto-proxy' | 'direct-fallback' | 'disabled' | 'local-direct';
  fallbackReason?: string;
}

export interface ResolveActorProxyDeps {
  isAtHome: boolean;
  createProxyConfiguration: (input: ActorProxyInput) => Promise<ProxyUrlProvider | undefined>;
  onFallback?: (message: string) => void;
}

/**
 * Initialize an Apify proxy session with bounded fallback so callers or automated
 * test accounts lacking RESIDENTIAL proxy permissions fall back cleanly instead of
 * failing before querying Google Trends. Explicit custom `proxyUrls` still fail fast.
 */
export async function resolveActorProxySession(rawInput: unknown, deps: ResolveActorProxyDeps): Promise<ResolvedActorProxy> {
  const proxyInput = actorProxyInput(rawInput);
  const hasCustomProxy = Array.isArray(proxyInput.proxyUrls) && proxyInput.proxyUrls.length > 0;
  const explicitlyDisabled = Boolean(
    rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
    && (rawInput as Record<string, unknown>).useApifyProxy === false
    && !hasCustomProxy,
  );
  if (explicitlyDisabled) return { session: null, mode: 'disabled' };
  if (!deps.isAtHome && !hasCustomProxy) return { session: null, mode: 'local-direct' };

  const tryInit = async (cfg: ActorProxyInput): Promise<ApifyProxySession | null> => {
    const provider = await deps.createProxyConfiguration(cfg);
    if (!provider) return null;
    const session = new ApifyProxySession(provider);
    const url = await session.rotate();
    return url ? session : null;
  };

  let lastError: unknown;
  try {
    const session = await tryInit(proxyInput);
    if (session) return { session, mode: 'requested' };
  } catch (error) {
    lastError = error;
  }

  const reason = lastError ? errorLabel(lastError) : 'empty-url';
  if (hasCustomProxy) {
    throw lastError instanceof Error ? lastError : new Error('Custom proxy returned no URL.');
  }
  if (!deps.isAtHome) {
    deps.onFallback?.('Apify proxy is unavailable locally; continuing with direct egress.');
    return { session: null, mode: 'direct-fallback', fallbackReason: reason };
  }

  const constrained = (Array.isArray(proxyInput.apifyProxyGroups) && proxyInput.apifyProxyGroups.length > 0)
    || Boolean(proxyInput.apifyProxyCountry);
  if (constrained) {
    try {
      const autoSession = await tryInit({ useApifyProxy: true });
      if (autoSession) {
        deps.onFallback?.(`Requested Apify proxy failed (${reason}); falling back to default Apify proxy.`);
        return { session: autoSession, mode: 'fallback-auto-proxy', fallbackReason: reason };
      }
    } catch {
      // Fall through to direct egress fallback.
    }
  }

  deps.onFallback?.('Apify proxy unavailable for this account; falling back to direct egress.');
  return { session: null, mode: 'direct-fallback', fallbackReason: reason };
}

/**
 * Holds the current Apify proxy URL and rotates its session id. The URL is
 * handed to a transport explicitly (see createRotatingTransport); this class
 * never mutates process.env, because dsh shares its process with other tools.
 */
export class ApifyProxySession {
  private counter = 0;
  private url: string | null = null;

  constructor(
    private readonly provider: ProxyUrlProvider,
    private readonly makeSessionId: (counter: number) => string = counter => `gtfa_${Date.now().toString(36)}_${counter.toString(36)}`,
  ) {}

  /** The URL produced by the last successful rotation (null before the first or when unavailable). */
  get currentUrl(): string | null { return this.url; }

  /** Rotate to a fresh proxy session and return the new URL (null when unavailable). */
  async rotate(): Promise<string | null> {
    this.counter += 1;
    const url = (await this.provider.newUrl(this.makeSessionId(this.counter)))?.trim() || null;
    this.url = url;
    return url;
  }
}

export interface RotatingTransportOptions {
  /** Build one proxy-aware transport from an explicit proxy URL. Defaults to createDefaultTransport. */
  createTransport?: (proxyUrl: string) => Transport;
  /** Called after a successful proxy-session rotation (no credentials passed). */
  onRotate?: (reason: 'rate_limited' | 'challenge' | 'network') => void;
  /** Called when rotation fails; the current transport stays in use. */
  onError?: (error: unknown) => void;
}

/**
 * Wraps the existing fetch transport and rotates the Apify proxy session when
 * Google returns 429 or a CAPTCHA challenge. The proxy URL is passed to the
 * transport factory directly, so sharing the dsh process cannot leak a proxy
 * into another tool's environment. withRetry retries RATE_LIMITED against the
 * new egress; BLOCKED is still surfaced to the agent.
 */
export function createRotatingTransport(
  session: Pick<ApifyProxySession, 'currentUrl' | 'rotate'>,
  options: RotatingTransportOptions = {},
): Transport {
  const makeTransport = options.createTransport ?? (url => createDefaultTransport({ HTTPS_PROXY: url }));
  let current = makeTransport(session.currentUrl ?? '');
  let rotating: Promise<void> | null = null;

  const rotate = async (reason: 'rate_limited' | 'challenge' | 'network') => {
    rotating ??= (async () => {
      try {
        const url = await session.rotate();
        if (url) {
          current = makeTransport(url);
          options.onRotate?.(reason);
        }
      } catch (error) {
        options.onError?.(error);
      }
    })().finally(() => { rotating = null; });
    await rotating;
  };

  return async request => {
    let response: Awaited<ReturnType<Transport>>;
    try {
      response = await current(request);
    } catch (error) {
      // A failed proxy connection (for example a dead residential exit) gets a
      // fresh session before the caller retries.
      if (!request.signal?.aborted) await rotate('network');
      throw error;
    }
    const reason = isRateLimitResponse(response) ? 'rate_limited' : isChallengeResponse(response) ? 'challenge' : null;
    if (reason) await rotate(reason);
    return response;
  };
}
