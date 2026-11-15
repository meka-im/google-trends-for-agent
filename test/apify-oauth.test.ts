import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GTFA_APIFY_OAUTH_CLIENT_ID,
  GTFA_APIFY_OAUTH_CLIENT_RECORD,
  GTFA_APIFY_OAUTH_SESSION,
  GTFA_APIFY_OAUTH_SESSION_RECORD,
  createApifyOAuthManager,
  type OAuthCredentialRecord,
  type OAuthCredentialsService,
} from '../src/apify-oauth.js';

const ISSUER = 'https://console-backend.apify.com';
const METADATA_URL = `${ISSUER}/.well-known/oauth-authorization-server`;
const REGISTRATION_URL = `${ISSUER}/oauth/apps`;
const DEVICE_URL = `${ISSUER}/oauth/apps/devices`;
const TOKEN_URL = `${ISSUER}/oauth/apps/token`;
const VERIFICATION_URL = 'https://console.apify.com/authorize/device';

type Responder = (call: number, init?: RequestInit) => Response | Promise<Response>;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function defaultMetadata() {
  return {
    issuer: ISSUER,
    registration_endpoint: REGISTRATION_URL,
    device_authorization_endpoint: DEVICE_URL,
    token_endpoint: TOKEN_URL,
  };
}

function defaultDevice() {
  return {
    device_code: 'private-device-code',
    user_code: 'ABCD-EFGH',
    verification_uri: VERIFICATION_URL,
    verification_uri_complete: `${VERIFICATION_URL}?user_code=ABCD-EFGH`,
    expires_in: 600,
    interval: 5,
  };
}

function oauthFetch(options: {
  metadata?: Responder;
  registration?: Responder;
  device?: Responder;
  token?: Responder;
} = {}) {
  const counts = new Map<string, number>();
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const call = (counts.get(url) ?? 0) + 1;
    counts.set(url, call);
    if (url === METADATA_URL) {
      return (options.metadata ?? (() => response(defaultMetadata())))(call, init);
    }
    if (url === REGISTRATION_URL) {
      return (options.registration ?? (() => response({ client_id: 'client-1' }, 201)))(call, init);
    }
    if (url === DEVICE_URL) {
      return (options.device ?? (() => response(defaultDevice())))(call, init);
    }
    if (url === TOKEN_URL) {
      return (options.token ?? (() => response({
        access_token: 'oauth-access-token',
        token_type: 'Bearer',
      })))(call, init);
    }
    throw new Error(`unexpected OAuth URL ${url}`);
  });
  return {
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    calls,
    count(url: string) {
      return counts.get(url) ?? 0;
    },
  };
}

class RefCredentials implements OAuthCredentialsService {
  readonly refs = new Map<string, string>();
  writable = true;
  failSet = false;
  failUnset = false;
  failResolve = false;

  async resolve(ref: string) {
    if (this.failResolve) throw new Error('resolve failed');
    const value = this.refs.get(ref);
    return value === undefined ? undefined : { value, source: 'memory' };
  }

  async describe(ref: string) {
    return { configured: this.refs.has(ref), writable: this.writable };
  }

  async set(ref: string, value: string) {
    if (this.failSet) throw new Error('set failed');
    this.refs.set(ref, value);
  }

  async unset(ref: string) {
    if (this.failUnset) throw new Error('unset failed');
    this.refs.delete(ref);
  }
}

class RecordCredentials extends RefCredentials {
  readonly records = new Map<string, OAuthCredentialRecord>();
  failRecordDelete = false;
  modifies = 0;
  private chain: Promise<unknown> = Promise.resolve();

  async readRecord(key: string) {
    return this.records.get(key);
  }

  async describeRecord(key: string) {
    const record = this.records.get(key);
    return {
      configured: Boolean(record),
      writable: this.writable,
      ...(record ? { kind: record.kind } : {}),
    };
  }

  async modifyRecord(
    key: string,
    mutate: (current: OAuthCredentialRecord | undefined) => Promise<OAuthCredentialRecord | undefined>,
  ) {
    this.modifies++;
    const operation = this.chain.then(async () => {
      const next = await mutate(this.records.get(key));
      if (next === undefined) this.records.delete(key);
      else this.records.set(key, next);
      return next;
    });
    this.chain = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async deleteRecord(key: string) {
    if (this.failRecordDelete) throw new Error('delete record failed');
    this.records.delete(key);
  }
}

function putSession(
  credentials: RefCredentials | RecordCredentials,
  session: Record<string, unknown>,
  record = credentials instanceof RecordCredentials,
) {
  if (record && credentials instanceof RecordCredentials) {
    if ('client_id' in session && Object.keys(session).length === 1) {
      credentials.records.set(GTFA_APIFY_OAUTH_CLIENT_RECORD, { kind: 'grant', payload: session });
    } else {
      credentials.records.set(GTFA_APIFY_OAUTH_SESSION_RECORD, { kind: 'grant', payload: session });
    }
    return;
  }
  if ('client_id' in session && Object.keys(session).length === 1) {
    credentials.refs.set(GTFA_APIFY_OAUTH_CLIENT_ID, String(session.client_id));
  } else {
    credentials.refs.set(GTFA_APIFY_OAUTH_SESSION, JSON.stringify(session));
  }
}

function managerFor(credentials: OAuthCredentialsService, server = oauthFetch(), now = () => 0) {
  return createApifyOAuthManager({
    credentials,
    fetch: server.fetch,
    now,
    timeoutMs: 1000,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Apify OAuth credential resolution', () => {
  it('uses records before refs and falls back to refs only when no record exists', async () => {
    const credentials = new RecordCredentials();
    credentials.refs.set(GTFA_APIFY_OAUTH_SESSION, JSON.stringify({ access_token: 'legacy-ref-token' }));
    const manager = managerFor(credentials);
    expect(await manager.resolveToken('config-token')).toEqual({ token: 'legacy-ref-token', source: 'oauth' });

    putSession(credentials, { access_token: 'record-token' });
    expect(await manager.resolveToken('config-token')).toEqual({ token: 'record-token', source: 'oauth' });

    credentials.records.set(GTFA_APIFY_OAUTH_SESSION_RECORD, { kind: 'grant', payload: { access_token: '' } });
    expect(await manager.resolveToken('config-token')).toMatchObject({ code: 'reauth-required' });
  });

  it('falls back to config then env only when no OAuth session exists', async () => {
    const credentials = new RefCredentials();
    const manager = managerFor(credentials);
    expect(await manager.resolveToken('config-token')).toEqual({ token: 'config-token', source: 'config' });
    vi.stubEnv('APIFY_TOKEN', 'env-token');
    expect(await manager.resolveToken()).toEqual({ token: 'env-token', source: 'env' });
  });

  it.each([
    { access_token: 'token', expires_at: 'tomorrow' },
    { access_token: 'token', expires_at: 0 },
    { access_token: 'token', expires_at: Number.NaN },
    { access_token: 'token', refresh_token: 42 },
    { access_token: 'token with space' },
    { access_token: ' token ' },
    { access_token: 'token\tcontrol' },
    { access_token: 'token\u0000nul' },
    { access_token: 'tökén' },
    { access_token: 'a=b' },
    { access_token: 'token', refresh_token: 'refresh\nvalue' },
  ])('rejects a present invalid session field instead of treating it as long-lived: %j', async session => {
    const credentials = new RefCredentials();
    credentials.refs.set(GTFA_APIFY_OAUTH_SESSION, JSON.stringify(session));
    const manager = managerFor(credentials);
    expect(await manager.status()).toMatchObject({ connected: false, code: 'reauth-required' });
    expect(await manager.resolveToken('config-token')).toMatchObject({ code: 'reauth-required' });
  });

  it('supports a long-lived token with no expiry', async () => {
    const credentials = new RefCredentials();
    credentials.refs.set(GTFA_APIFY_OAUTH_SESSION, JSON.stringify({ access_token: 'long-lived-token' }));
    expect(await managerFor(credentials).resolveToken()).toEqual({ token: 'long-lived-token', source: 'oauth' });
  });

  it('accepts the RFC 6750 token character set', async () => {
    const token = 'abc.DEF_~+/-==';
    const credentials = new RefCredentials();
    credentials.refs.set(GTFA_APIFY_OAUTH_SESSION, JSON.stringify({
      access_token: token,
      refresh_token: 'refresh._~+/==',
    }));
    expect(await managerFor(credentials).resolveToken()).toEqual({ token, source: 'oauth' });
  });
});

describe('device authorization', () => {
  it('registers once, reuses the client id, and performs no DCR on status polling', async () => {
    const credentials = new RecordCredentials();
    const server = oauthFetch();
    const manager = managerFor(credentials, server);

    const first = await manager.start();
    expect(first).toMatchObject({ available: true, connected: false, pending: true });
    expect(server.count(REGISTRATION_URL)).toBe(1);
    expect(server.count(DEVICE_URL)).toBe(1);
    expect(credentials.records.get(GTFA_APIFY_OAUTH_CLIENT_RECORD)).toMatchObject({
      kind: 'grant',
      payload: { client_id: 'client-1' },
    });

    expect(await manager.start()).toEqual(first);
    expect(server.count(REGISTRATION_URL)).toBe(1);
    expect(server.count(DEVICE_URL)).toBe(1);
    expect(await manager.status()).toEqual(first);
    expect(server.count(TOKEN_URL)).toBe(0);

    await manager.cancel();
    const restarted = await manager.start();
    expect(restarted.pending).toBe(true);
    expect(server.count(REGISTRATION_URL)).toBe(1);
    expect(server.count(DEVICE_URL)).toBe(2);
  });

  it('throttles status polls and handles authorization_pending and slow_down as HTTP 400', async () => {
    let now = 1_000;
    const credentials = new RefCredentials();
    const server = oauthFetch({
      token: call => call === 3
        ? response({ access_token: 'oauth-token', token_type: 'Bearer' })
        : response({ error: call === 1 ? 'authorization_pending' : 'slow_down' }, 400),
    });
    const manager = managerFor(credentials, server, () => now);

    await manager.start();
    expect((await manager.status()).pending).toBe(true);
    expect(server.count(TOKEN_URL)).toBe(0);

    now += 5_000;
    expect(await manager.status()).toMatchObject({ pending: true });
    expect(server.count(TOKEN_URL)).toBe(1);
    now += 4_999;
    expect((await manager.status()).pending).toBe(true);
    expect(server.count(TOKEN_URL)).toBe(1);

    now += 1;
    expect(await manager.status()).toMatchObject({ pending: true });
    expect(server.count(TOKEN_URL)).toBe(2);
    now += 9_999;
    expect((await manager.status()).pending).toBe(true);
    expect(server.count(TOKEN_URL)).toBe(2);

    now += 1;
    expect(await manager.status()).toEqual({ available: true, connected: true, pending: false });
    expect(server.count(TOKEN_URL)).toBe(3);
    expect(await manager.resolveToken('config-token')).toEqual({ token: 'oauth-token', source: 'oauth' });
  });

  it('keeps the pending flow on transient network failure and clears it on access_denied', async () => {
    let now = 0;
    const server = oauthFetch({
      token: call => {
        if (call === 1) throw new TypeError('offline');
        return response({ error: 'access_denied' }, 400);
      },
    });
    const manager = managerFor(new RefCredentials(), server, () => now);
    await manager.start();

    now = 5_000;
    expect(await manager.status()).toMatchObject({ pending: true });
    now = 10_000;
    expect(await manager.status()).toMatchObject({ code: 'access-denied', pending: false });
  });

  it('re-registers only when a stored client id is rejected with invalid_client', async () => {
    const credentials = new RecordCredentials();
    putSession(credentials, { client_id: 'stale-client' });
    const server = oauthFetch({
      registration: call => response({ client_id: `client-${call + 1}` }, 201),
      device: call => call === 1
        ? response({ error: 'invalid_client' }, 400)
        : response(defaultDevice()),
    });
    const manager = managerFor(credentials, server);

    expect(await manager.start()).toMatchObject({ pending: true });
    expect(server.count(REGISTRATION_URL)).toBe(1);
    expect(server.count(DEVICE_URL)).toBe(2);
    expect(credentials.records.get(GTFA_APIFY_OAUTH_CLIENT_RECORD)?.payload).toEqual({ client_id: 'client-2' });
  });

  it('keeps client_id opaque while rejecting control bytes', async () => {
    const opaqueServer = oauthFetch({
      registration: () => response({ client_id: '浏览器-client' }, 201),
    });
    const opaqueCredentials = new RecordCredentials();
    expect(await managerFor(opaqueCredentials, opaqueServer).start()).toMatchObject({ pending: true });
    expect(opaqueCredentials.records.get(GTFA_APIFY_OAUTH_CLIENT_RECORD)?.payload)
      .toEqual({ client_id: '浏览器-client' });

    const invalidServer = oauthFetch({
      registration: () => response({ client_id: 'bad\u0000id' }, 201),
    });
    expect(await managerFor(new RecordCredentials(), invalidServer).start()).toMatchObject({
      code: 'invalid-response',
    });
    expect(invalidServer.count(DEVICE_URL)).toBe(0);
  });

  it('rejects control bytes in device_code', async () => {
    const server = oauthFetch({
      device: () => response({ ...defaultDevice(), device_code: 'bad\ndevice' }),
    });
    expect(await managerFor(new RefCredentials(), server).start()).toMatchObject({
      code: 'invalid-response',
      pending: false,
    });
  });

  it('rejects metadata without the exact trusted endpoints before DCR', async () => {
    const server = oauthFetch({
      metadata: () => response({ ...defaultMetadata(), token_endpoint: `${ISSUER}/oauth/apps/evil-token` }),
    });
    const view = await managerFor(new RefCredentials(), server).start();
    expect(view).toMatchObject({ code: 'invalid-response', pending: false });
    expect(server.count(REGISTRATION_URL)).toBe(0);
    expect(JSON.stringify(view)).not.toContain('private-device-code');
  });

  it('rejects a verification URL outside the Apify console path', async () => {
    const server = oauthFetch({
      device: () => response({
        ...defaultDevice(),
        verification_uri_complete: 'https://attacker.test/authorize/device?user_code=ABCD-EFGH',
      }),
    });
    expect(await managerFor(new RefCredentials(), server).start()).toMatchObject({ code: 'invalid-response' });
  });
});

describe('cancellation and logout races', () => {
  it.each(['cancel', 'logout'] as const)(
    'invalidates a same-tick start before avoidable DCR/device work on %s',
    async action => {
      const credentials = new RefCredentials();
      const server = oauthFetch();
      const manager = managerFor(credentials, server);

      const starting = manager.start();
      const stopping = action === 'cancel' ? manager.cancel() : manager.logout();
      const [startView, stopView] = await Promise.all([starting, stopping]);

      expect(startView).toEqual({ available: true, connected: false, pending: false });
      expect(stopView).toEqual({ available: true, connected: false, pending: false });
      expect(server.calls).toEqual([]);
      expect(await manager.status()).toEqual({ available: true, connected: false, pending: false });
    },
  );

  it('cancels an in-flight successful token poll before it can persist a session', async () => {
    let now = 0;
    let release!: (value: Response) => void;
    let tokenStarted!: () => void;
    const started = new Promise<void>(resolve => { tokenStarted = resolve; });
    let tokenSignal: AbortSignal | undefined;
    const server = oauthFetch({
      token: (_call, init) => {
        tokenSignal = init?.signal as AbortSignal;
        tokenStarted();
        return new Promise<Response>(resolve => { release = resolve; });
      },
    });
    const credentials = new RefCredentials();
    const manager = managerFor(credentials, server, () => now);
    await manager.start();
    now = 5_000;

    const polling = manager.status();
    await started;
    const cancelling = manager.cancel();
    expect(tokenSignal?.aborted).toBe(true);
    release(response({ access_token: 'late-token', token_type: 'Bearer' }));

    expect(await polling).toEqual({ available: true, connected: false, pending: false });
    expect(await cancelling).toEqual({ available: true, connected: false, pending: false });
    expect(credentials.refs.has(GTFA_APIFY_OAUTH_SESSION)).toBe(false);
    expect(await manager.resolveToken('config-token')).toEqual({ token: 'config-token', source: 'config' });
  });

  it('cancels an in-flight start before it can publish a pending device flow', async () => {
    let release!: (value: Response) => void;
    let registrationStarted!: () => void;
    const started = new Promise<void>(resolve => { registrationStarted = resolve; });
    const server = oauthFetch({
      registration: () => {
        registrationStarted();
        return new Promise<Response>(resolve => { release = resolve; });
      },
    });
    const manager = managerFor(new RefCredentials(), server);
    const starting = manager.start();
    await started;
    const loggingOut = manager.logout();
    release(response({ client_id: 'client-1' }, 201));

    expect(await starting).toMatchObject({ connected: false, pending: false });
    expect(await loggingOut).toEqual({ available: true, connected: false, pending: false });
    expect(server.count(DEVICE_URL)).toBe(0);
    expect((await manager.status()).pending).toBe(false);
  });

  it('aborts an in-flight OAuth request on dispose', async () => {
    let requestStarted!: () => void;
    const started = new Promise<void>(resolve => { requestStarted = resolve; });
    const server = oauthFetch({
      metadata: () => {
        requestStarted();
        return new Promise<Response>(() => {});
      },
    });
    const manager = managerFor(new RefCredentials(), server);
    const starting = manager.start();
    await started;
    manager.dispose();
    expect(await starting).toEqual({ available: true, connected: false, pending: false });
    expect(server.count(REGISTRATION_URL)).toBe(0);
  });

  it('reports storage failure on logout and never claims success', async () => {
    const credentials = new RefCredentials();
    credentials.refs.set(GTFA_APIFY_OAUTH_SESSION, JSON.stringify({ access_token: 'existing-token' }));
    credentials.failUnset = true;
    const view = await managerFor(credentials).logout();
    expect(view).toMatchObject({ connected: true, code: 'storage' });
  });

  it('reports a records delete failure without hiding the existing session', async () => {
    const credentials = new RecordCredentials();
    putSession(credentials, { access_token: 'existing-token' });
    credentials.failRecordDelete = true;
    const view = await managerFor(credentials).logout();
    expect(view).toMatchObject({ connected: true, code: 'storage' });
  });
});

describe('refresh and persistence', () => {
  it('serializes record refresh, rotates the refresh token once, and reuses the result', async () => {
    let now = 100_000;
    const credentials = new RecordCredentials();
    putSession(credentials, { client_id: 'client-1' });
    putSession(credentials, {
      access_token: 'expired-token',
      refresh_token: 'refresh-1',
      expires_at: now - 1,
    });
    const server = oauthFetch({
      token: () => response({
        access_token: 'fresh-token',
        refresh_token: 'refresh-2',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    });
    const manager = managerFor(credentials, server, () => now);

    const [first, second] = await Promise.all([manager.status(), manager.status()]);
    expect(first.connected).toBe(true);
    expect(second.connected).toBe(true);
    expect(server.count(TOKEN_URL)).toBe(1);
    expect(credentials.records.get(GTFA_APIFY_OAUTH_SESSION_RECORD)?.payload).toMatchObject({
      access_token: 'fresh-token',
      refresh_token: 'refresh-2',
    });
    expect(await manager.resolveToken('config-token')).toEqual({ token: 'fresh-token', source: 'oauth' });
    now += 3_600_000;
  });

  it('maps a revoked refresh token to reauth-required without falling back to config', async () => {
    const credentials = new RecordCredentials();
    putSession(credentials, { client_id: 'client-1' });
    putSession(credentials, {
      access_token: 'expired-token',
      refresh_token: 'revoked-token',
      expires_at: 1,
    });
    const server = oauthFetch({
      token: () => response({ error: 'invalid_grant' }, 400),
    });
    const manager = managerFor(credentials, server, () => 10_000);
    expect(await manager.resolveToken('config-token')).toMatchObject({ code: 'reauth-required' });
    expect(await manager.status()).toMatchObject({ connected: false, code: 'reauth-required' });
  });

  it('does not publish a token until persistence succeeds', async () => {
    let now = 0;
    const credentials = new RefCredentials();
    const manager = managerFor(credentials, oauthFetch(), () => now);
    expect(await manager.start()).toMatchObject({ pending: true });
    credentials.failSet = true;
    now = 5_000;
    expect(await manager.status()).toMatchObject({ code: 'storage', pending: false });
    expect(await manager.resolveToken('config-token')).toEqual({ token: 'config-token', source: 'config' });
  });

  it('rejects an invalid Bearer token returned by the token endpoint', async () => {
    let now = 0;
    const server = oauthFetch({
      token: () => response({ access_token: 'bad token', token_type: 'Bearer' }),
    });
    const credentials = new RefCredentials();
    const manager = managerFor(credentials, server, () => now);
    await manager.start();
    now = 5_000;
    expect(await manager.status()).toMatchObject({ code: 'invalid-response', pending: false });
    expect(credentials.refs.has(GTFA_APIFY_OAUTH_SESSION)).toBe(false);
  });

  it('clears a pending flow when the token response body is oversized', async () => {
    let now = 0;
    const server = oauthFetch({
      token: () => new Response('x'.repeat(70_000), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });
    const manager = managerFor(new RefCredentials(), server, () => now);
    await manager.start();
    now = 5_000;
    expect(await manager.status()).toMatchObject({ code: 'invalid-response', pending: false });
  });

  it('times out a stalled response body without hanging the status request', async () => {
    let now = 0;
    const stalled = new ReadableStream<Uint8Array>({ start() {} });
    const server = oauthFetch({
      token: () => new Response(stalled, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });
    const manager = createApifyOAuthManager({
      credentials: new RefCredentials(),
      fetch: server.fetch,
      now: () => now,
      timeoutMs: 20,
    });
    await manager.start();
    now = 5_000;
    expect(await manager.status()).toMatchObject({ pending: true });
    manager.dispose();
  });
});

describe('credential service availability', () => {
  it('reports unavailable without credentials but keeps legacy resolution', async () => {
    const manager = createApifyOAuthManager({ fetch: oauthFetch().fetch });
    expect(await manager.status()).toMatchObject({ available: false, code: 'unavailable' });
    expect(await manager.resolveToken('config-token')).toEqual({ token: 'config-token', source: 'config' });
  });

  it('honors a read-only credential profile before start', async () => {
    const credentials = new RefCredentials();
    credentials.writable = false;
    const server = oauthFetch();
    expect(await managerFor(credentials, server).start()).toMatchObject({ code: 'read-only' });
    expect(server.calls).toEqual([]);
  });

  it('never exposes tokens or device_code through public views', async () => {
    const credentials = new RefCredentials();
    const server = oauthFetch({
      token: () => response({ access_token: 'secret-access-token', token_type: 'Bearer' }),
    });
    let now = 0;
    const manager = managerFor(credentials, server, () => now);
    const pending = await manager.start();
    expect(JSON.stringify(pending)).not.toContain('private-device-code');
    expect(JSON.stringify(pending)).not.toContain('secret-access-token');
    now = 5_000;
    const connected = await manager.status();
    expect(JSON.stringify(connected)).not.toContain('secret-access-token');
  });
});
