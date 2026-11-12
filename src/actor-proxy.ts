import {
  createDefaultTransport,
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
  onRotate?: (reason: 'rate_limited' | 'challenge') => void;
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

  return async request => {
    const response = await current(request);
    const reason = isRateLimitResponse(response) ? 'rate_limited' : isChallengeResponse(response) ? 'challenge' : null;
    if (reason) {
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
    }
    return response;
  };
}
