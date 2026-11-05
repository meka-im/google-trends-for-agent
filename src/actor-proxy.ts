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
 * Holds the current Apify proxy URL and writes it to HTTPS_PROXY so the
 * existing transport (createDefaultTransport) is reused as-is. Rotating only
 * changes the session id, i.e. the egress IP, not the networking code.
 */
export class ApifyProxySession {
  private counter = 0;

  constructor(
    private readonly provider: ProxyUrlProvider,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly makeSessionId: (counter: number) => string = counter => `gtfa_${Date.now().toString(36)}_${counter.toString(36)}`,
  ) {}

  /** Rotate to a fresh proxy session and return the new URL (null when unavailable). */
  async rotate(): Promise<string | null> {
    this.counter += 1;
    const url = (await this.provider.newUrl(this.makeSessionId(this.counter)))?.trim() || null;
    if (url) {
      // HTTPS_PROXY wins over HTTP_PROXY in getProxyConfig; clear a stale lowercase alias.
      this.env.HTTPS_PROXY = url;
      delete this.env.https_proxy;
      return url;
    }
    delete this.env.HTTPS_PROXY;
    delete this.env.https_proxy;
    return null;
  }
}

export interface RotatingTransportOptions {
  /** Factory for the existing proxy-aware transport. Defaults to createDefaultTransport. */
  createTransport?: () => Transport;
  /** Called after a successful proxy-session rotation (no credentials passed). */
  onRotate?: (reason: 'rate_limited' | 'challenge') => void;
  /** Called when rotation fails; the current transport stays in use. */
  onError?: (error: unknown) => void;
}

/**
 * Wraps the existing fetch transport and rotates the Apify proxy session when
 * Google returns 429 or a CAPTCHA challenge. withRetry retries RATE_LIMITED
 * against the new egress; BLOCKED is still surfaced to the agent.
 */
export function createRotatingTransport(
  session: Pick<ApifyProxySession, 'rotate'>,
  options: RotatingTransportOptions = {},
): Transport {
  const makeTransport = options.createTransport ?? (() => createDefaultTransport());
  let current = makeTransport();
  let rotating: Promise<void> | null = null;

  return async request => {
    const response = await current(request);
    const reason = isRateLimitResponse(response) ? 'rate_limited' : isChallengeResponse(response) ? 'challenge' : null;
    if (reason) {
      rotating ??= (async () => {
        try {
          const url = await session.rotate();
          if (url) {
            current = makeTransport();
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
