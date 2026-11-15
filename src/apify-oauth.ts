import { raceAbort } from './transport.js';

export const APIFY_OAUTH_STATUS_PATH = '/api/gtfa.apify-oauth';
export const APIFY_OAUTH_START_PATH = '/api/gtfa.apify-oauth-start';
export const APIFY_OAUTH_CANCEL_PATH = '/api/gtfa.apify-oauth-cancel';
export const APIFY_OAUTH_LOGOUT_PATH = '/api/gtfa.apify-oauth-logout';

export const GTFA_APIFY_OAUTH_SESSION = 'GTFA_APIFY_OAUTH_SESSION';
export const GTFA_APIFY_OAUTH_CLIENT_ID = 'GTFA_APIFY_OAUTH_CLIENT_ID';
export const GTFA_APIFY_OAUTH_SESSION_RECORD = 'gtfa/apify-oauth-session';
export const GTFA_APIFY_OAUTH_CLIENT_RECORD = 'gtfa/apify-oauth-client';

const ISSUER = 'https://console-backend.apify.com';
const METADATA_URL = `${ISSUER}/.well-known/oauth-authorization-server`;
const REGISTRATION_ENDPOINT = `${ISSUER}/oauth/apps`;
const DEVICE_ENDPOINT = `${ISSUER}/oauth/apps/devices`;
const TOKEN_ENDPOINT = `${ISSUER}/oauth/apps/token`;
const VERIFICATION_ORIGIN = 'https://console.apify.com';
const VERIFICATION_PATH = '/authorize/device';
const CLIENT_NAME = 'Google Trends for dsh';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const SCOPE = 'full_api_access';
const MAX_JSON_CHARS = 64_000;
const MAX_TOKEN_CHARS = 16_384;
const BEARER_TOKEN = /^[A-Za-z0-9._~+/-]+=*$/;

export type ApifyOAuthCode =
  | 'unavailable'
  | 'read-only'
  | 'network'
  | 'invalid-response'
  | 'access-denied'
  | 'expired'
  | 'storage'
  | 'reauth-required'
  | 'busy';

export interface ApifyOAuthView {
  available: boolean;
  connected: boolean;
  pending: boolean;
  verificationUri?: string;
  userCode?: string;
  expiresAt?: string;
  code?: ApifyOAuthCode;
  message?: string;
}

export interface OAuthCredentialValue {
  value: string;
  source: string;
}

export interface OAuthCredentialDescription {
  configured: boolean;
  source?: string;
  writable: boolean;
}

export interface OAuthCredentialRecord {
  kind: 'grant';
  payload: unknown;
}

export interface OAuthCredentialRecordDescription {
  configured: boolean;
  kind?: string;
  writable: boolean;
}

interface OAuthCredentialsRecords {
  readRecord(key: string): Promise<OAuthCredentialRecord | undefined>;
  describeRecord(key: string): Promise<OAuthCredentialRecordDescription>;
  modifyRecord(
    key: string,
    mutate: (current: OAuthCredentialRecord | undefined) => Promise<OAuthCredentialRecord | undefined>,
  ): Promise<OAuthCredentialRecord | undefined>;
  deleteRecord(key: string): Promise<void>;
}

/** Structural subset of @deepseek-ai/dsh-credentials used by the plugin. */
export interface OAuthCredentialsService extends Partial<OAuthCredentialsRecords> {
  resolve(ref: string): Promise<OAuthCredentialValue | undefined>;
  describe(ref: string): Promise<OAuthCredentialDescription>;
  set(ref: string, value: string): Promise<void>;
  unset(ref: string): Promise<void>;
}

export type OAuthCredentialsProvider =
  | OAuthCredentialsService
  | undefined
  | (() => OAuthCredentialsService | undefined);

export interface ApifyOAuthManagerOptions {
  /** Getter is called for every operation, so a late-loaded service starts working. */
  credentials?: OAuthCredentialsProvider;
  /** Fetch implementation for OAuth HTTP calls; production uses global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Clock override for expiry and poll throttling. */
  now?: () => number;
  /** Per OAuth request timeout. Default 10 seconds. */
  timeoutMs?: number;
}

export type OAuthTokenSource = 'oauth' | 'config' | 'env';

export interface OAuthTokenResolution {
  token?: string;
  source?: OAuthTokenSource;
  code?: Exclude<ApifyOAuthCode, 'read-only' | 'access-denied' | 'expired' | 'busy'>;
  message?: string;
}

interface OAuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface PendingDevice {
  generation: number;
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  intervalMs: number;
  nextPollAt: number;
}

type JsonObject = Record<string, unknown>;

type RequestResult =
  | { ok: true; status: number; body: JsonObject }
  | { ok: false; status?: number; code: 'network' | 'invalid-response'; oauthError?: string };

const MESSAGES: Record<ApifyOAuthCode, string> = {
  unavailable: 'Apify OAuth is unavailable because dsh credentials are not mounted.',
  'read-only': 'Apify OAuth credentials are read-only in this profile.',
  network: 'Could not reach Apify OAuth. Check connectivity and try again.',
  'invalid-response': 'Apify OAuth returned an invalid response.',
  'access-denied': 'Apify authorization was denied. Start again when ready.',
  expired: 'The device authorization expired. Start again.',
  storage: 'Could not save or clear OAuth credentials. Check dsh credential storage and try again.',
  'reauth-required': 'The stored Apify OAuth session is invalid. Sign in again.',
  busy: 'Another OAuth operation is in progress. Try again in a moment.',
};

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function stringValue(value: unknown, max = MAX_TOKEN_CHARS): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
}

function oauthToken(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > MAX_TOKEN_CHARS || !value) return undefined;
  return BEARER_TOKEN.test(value) ? value : undefined;
}

/** Opaque form values may be Unicode, but never contain terminal/control bytes. */
function opaqueValue(value: unknown, max = MAX_TOKEN_CHARS): string | undefined {
  const text = stringValue(value, max);
  return text && !/[\u0000-\u001f\u007f-\u009f]/.test(text) ? text : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function oauthError(body: JsonObject): string | undefined {
  return stringValue(body.error, 200);
}

function errorView(code: ApifyOAuthCode, available = true): ApifyOAuthView {
  return { available, connected: false, pending: false, code, message: MESSAGES[code] };
}

function pendingView(pending: PendingDevice): ApifyOAuthView {
  return {
    available: true,
    connected: false,
    pending: true,
    verificationUri: pending.verificationUri,
    userCode: pending.userCode,
    expiresAt: new Date(pending.expiresAt).toISOString(),
  };
}

function connectedView(): ApifyOAuthView {
  return { available: true, connected: true, pending: false };
}

function parseSession(value: string | undefined): OAuthSession | undefined {
  if (value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  return parseSessionFields(parsed);
}

function parseSessionFields(value: unknown): OAuthSession | undefined {
  const parsed = object(value);
  const accessField = field(parsed, 'access_token', 'accessToken');
  const accessToken = accessField.present ? oauthToken(accessField.value) : undefined;
  if (!accessToken) return undefined;
  const refreshField = field(parsed, 'refresh_token', 'refreshToken');
  const refreshToken = refreshField.present ? oauthToken(refreshField.value) : undefined;
  if (refreshField.present && !refreshToken) return undefined;
  const expiryField = field(parsed, 'expires_at', 'expiresAt');
  const rawExpiry = expiryField.value;
  const expiresAt = typeof rawExpiry === 'number' && Number.isFinite(rawExpiry) && rawExpiry > 0 ? rawExpiry : undefined;
  if (expiryField.present && !expiresAt) return undefined;
  return { accessToken, ...(refreshToken ? { refreshToken } : {}), ...(expiresAt ? { expiresAt } : {}) };
}

function field(
  value: JsonObject,
  snake: string,
  camel: string,
): { present: boolean; value?: unknown } {
  if (Object.hasOwn(value, snake)) return { present: true, value: value[snake] };
  if (Object.hasOwn(value, camel)) return { present: true, value: value[camel] };
  return { present: false };
}

function serializeSession(session: OAuthSession): string {
  return JSON.stringify({
    access_token: session.accessToken,
    ...(session.refreshToken ? { refresh_token: session.refreshToken } : {}),
    ...(session.expiresAt ? { expires_at: session.expiresAt } : {}),
  });
}

function sessionPayload(session: OAuthSession): JsonObject {
  return {
    access_token: session.accessToken,
    ...(session.refreshToken ? { refresh_token: session.refreshToken } : {}),
    ...(session.expiresAt ? { expires_at: session.expiresAt } : {}),
  };
}

function sessionRecord(session: OAuthSession): OAuthCredentialRecord {
  return { kind: 'grant', payload: sessionPayload(session) };
}

function parseSessionRecord(record: OAuthCredentialRecord | undefined): OAuthSession | undefined {
  if (!record || record.kind !== 'grant') return undefined;
  if (typeof record.payload === 'string') return parseSession(record.payload);
  return parseSessionFields(record.payload);
}

function clientPayload(clientId: string): JsonObject {
  return { client_id: clientId };
}

function parseClientRecord(record: OAuthCredentialRecord | undefined): string | undefined {
  if (!record || record.kind !== 'grant') return undefined;
  if (typeof record.payload === 'string') return opaqueValue(record.payload);
  const payload = object(record.payload);
  return opaqueValue(payload.client_id ?? payload.clientId);
}

function activeSession(session: OAuthSession, now: number): boolean {
  return session.expiresAt === undefined || session.expiresAt > now;
}

function expiryFrom(now: number, seconds: number): number | undefined {
  const value = now + seconds * 1000;
  return Number.isFinite(value) && value > now && value <= 8.64e15 ? value : undefined;
}

function expectedUrl(raw: unknown, expected: string): boolean {
  if (typeof raw !== 'string' || raw !== expected) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.origin === ISSUER && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

function verificationUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      url.origin !== VERIFICATION_ORIGIN ||
      url.pathname !== VERIFICATION_PATH ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    ) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function parseBody(text: string): JsonObject | undefined {
  if (text.length > MAX_JSON_CHARS) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
  } catch {
    return undefined;
  }
}

/**
 * OAuth-first Apify credential manager for the dsh host.
 *
 * The credentials service is resolved on every operation rather than captured
 * at plugin boot. Long-lived Apify tokens are supported; standard refresh
 * responses are also handled when the server sends one.
 */
export class ApifyOAuthManager {
  private readonly credentialsOption: OAuthCredentialsProvider;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly clock: () => number;
  private readonly timeoutMs: number;
  private queue: Promise<unknown> = Promise.resolve();
  private pending: PendingDevice | undefined;
  private generation = 0;
  private disposed = false;
  private readonly requests = new Set<AbortController>();

  constructor(options: ApifyOAuthManagerOptions = {}) {
    this.credentialsOption = options.credentials;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.clock = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /** Current safe status. A status GET may poll an already-started device flow once. */
  status(signal?: AbortSignal): Promise<ApifyOAuthView> {
    return this.enqueue(() => this.statusLocked(signal));
  }

  /** Start a new device flow. This is the only operation that performs DCR/device calls. */
  start(signal?: AbortSignal): Promise<ApifyOAuthView> {
    const generation = this.generation;
    return this.enqueue(() => this.startLocked(signal, generation));
  }

  /** Stop the pending device flow without clearing a successful session. */
  cancel(): Promise<ApifyOAuthView> {
    this.interrupt();
    return this.enqueue(() => this.cancelLocked());
  }

  /** Stop the pending flow and clear only the OAuth session, retaining the client id. */
  logout(): Promise<ApifyOAuthView> {
    this.interrupt();
    return this.enqueue(() => this.logoutLocked());
  }

  /** Resolve the token used by every Actor tool/route, in OAuth-first order. */
  resolveToken(legacyToken?: string | null): Promise<OAuthTokenResolution> {
    const generation = this.generation;
    return this.enqueue(() => this.resolveTokenLocked(legacyToken, generation));
  }

  /** Abort in-flight OAuth requests when the plugin is disposed. */
  dispose(): void {
    this.disposed = true;
    this.interrupt();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  /** Invalidate pending work immediately, even while an OAuth request is in flight. */
  private interrupt(): void {
    this.generation++;
    this.pending = undefined;
    for (const request of this.requests) request.abort();
  }

  private credentials(): OAuthCredentialsService | undefined {
    const value = typeof this.credentialsOption === 'function' ? this.credentialsOption() : this.credentialsOption;
    return value;
  }

  private async credentialsSafe(): Promise<OAuthCredentialsService | undefined> {
    try {
      return this.credentials();
    } catch {
      return undefined;
    }
  }

  private records(service: OAuthCredentialsService): OAuthCredentialsRecords | undefined {
    const candidate = service as OAuthCredentialsService & Partial<OAuthCredentialsRecords>;
    return typeof candidate.readRecord === 'function' &&
      typeof candidate.describeRecord === 'function' &&
      typeof candidate.modifyRecord === 'function' &&
      typeof candidate.deleteRecord === 'function'
      ? candidate as OAuthCredentialsRecords
      : undefined;
  }

  private async statusLocked(signal?: AbortSignal): Promise<ApifyOAuthView> {
    if (this.disposed) return errorView('unavailable', false);
    const service = await this.credentialsSafe();
    if (!service) return errorView('unavailable', false);

    const stored = await this.readSession(service);
    if (stored.error) return stored.error;
    const session = stored.value;
    const now = this.clock();
    if (session && activeSession(session, now)) return connectedView();

    if (this.pending) {
      if (this.pending.expiresAt <= now) {
        this.pending = undefined;
        return errorView('expired');
      }
      if (now < this.pending.nextPollAt) return pendingView(this.pending);
      return this.pollLocked(service, signal);
    }

    if (stored.present) {
      if (!session) return errorView('reauth-required');
      if (session.refreshToken) {
        const description = await this.describeSession(service);
        if (description.error) return description.error;
        return this.refreshViewLocked(service, signal, description.value);
      }
      return errorView('reauth-required');
    }
    const description = await this.describeSession(service);
    if (description.error) return description.error;
    if (description.value?.writable === false) return errorView('read-only');
    return { available: true, connected: false, pending: false };
  }

  private async startLocked(signal: AbortSignal | undefined, generation: number): Promise<ApifyOAuthView> {
    if (this.disposed) return errorView('unavailable', false);
    const service = await this.credentialsSafe();
    if (!service) return errorView('unavailable', false);
    if (this.generation !== generation) return this.sessionOnlyView(service);

    const stored = await this.readSession(service);
    if (stored.error) return stored.error;
    const session = stored.value;
    if (session && activeSession(session, this.clock())) return connectedView();
    const description = await this.describeSession(service);
    if (description.error) return description.error;
    if (description.value?.writable === false) return errorView('read-only');
    if (this.pending) {
      if (this.pending.expiresAt > this.clock()) return pendingView(this.pending);
      this.pending = undefined;
    }

    let clientId: string | undefined;
    let clientIdWasStored = false;
    try {
      const existingClient = await this.readClientId(service);
      if (existingClient.error) return existingClient.error;
      clientId = existingClient.clientId;
      clientIdWasStored = Boolean(clientId);
    } catch {
      return errorView('storage');
    }
    if (this.disposed || this.generation !== generation) return this.sessionOnlyView(service);
    if (!clientId) {
      const registered = await this.registerClient(service, signal);
      if (this.disposed || this.generation !== generation) return this.sessionOnlyView(service);
      if (!registered.clientId) return registered.error ?? errorView('invalid-response');
      clientId = registered.clientId;
      if (!await this.writeClientId(service, clientId)) return errorView('storage');
    }

    let device = await this.deviceAuthorization(clientId, signal);
    if (this.disposed || this.generation !== generation) return this.sessionOnlyView(service);
    if (!device.ok && device.oauthError === 'invalid_client' && clientIdWasStored) {
      if (!await this.deleteClientId(service)) return errorView('storage');
      const registered = await this.registerClient(service, signal);
      if (this.disposed || this.generation !== generation) return this.sessionOnlyView(service);
      if (!registered.clientId) return registered.error ?? errorView('invalid-response');
      clientId = registered.clientId;
      if (!await this.writeClientId(service, clientId)) return errorView('storage');
      device = await this.deviceAuthorization(clientId, signal);
      if (this.disposed || this.generation !== generation) return this.sessionOnlyView(service);
    }
    if (!device.ok) return this.requestErrorView(device);
    const body = device.body;
    const deviceCode = opaqueValue(body.device_code);
    const userCode = opaqueValue(body.user_code, 256);
    const baseVerification = body.verification_uri === undefined ? undefined : verificationUrl(body.verification_uri);
    const completeVerification = body.verification_uri_complete === undefined ? undefined : verificationUrl(body.verification_uri_complete);
    if (
      (body.verification_uri !== undefined && !baseVerification) ||
      (body.verification_uri_complete !== undefined && !completeVerification)
    ) return errorView('invalid-response');
    const verification = completeVerification ?? baseVerification;
    const expiresIn = positiveNumber(body.expires_in);
    const interval = body.interval === undefined ? 5 : positiveNumber(body.interval);
    if (!deviceCode || !userCode || !verification || !expiresIn || !interval) return errorView('invalid-response');
    const expiresAt = expiryFrom(this.clock(), expiresIn);
    if (!expiresAt) return errorView('invalid-response');
    if (this.disposed || this.generation !== generation) {
      const current = await this.sessionOnlyView(service);
      return current;
    }

    const now = this.clock();
    this.pending = {
      generation,
      clientId,
      deviceCode,
      userCode,
      verificationUri: verification,
      expiresAt,
      intervalMs: interval * 1000,
      nextPollAt: now + interval * 1000,
    };
    return pendingView(this.pending);
  }

  private async cancelLocked(): Promise<ApifyOAuthView> {
    if (this.disposed) return errorView('unavailable', false);
    const service = await this.credentialsSafe();
    if (!service) return errorView('unavailable', false);
    return this.sessionOnlyView(service);
  }

  private async logoutLocked(): Promise<ApifyOAuthView> {
    if (this.disposed) return errorView('unavailable', false);
    const service = await this.credentialsSafe();
    if (!service) return errorView('unavailable', false);
    if (!await this.deleteSession(service)) {
      const current = await this.sessionOnlyView(service);
      return { ...current, code: 'storage', message: MESSAGES.storage };
    }
    return { available: true, connected: false, pending: false };
  }

  private async resolveTokenLocked(legacyToken: string | null | undefined, generation: number): Promise<OAuthTokenResolution> {
    if (this.disposed || this.generation !== generation) {
      return { code: 'unavailable', message: MESSAGES.unavailable };
    }
    const service = await this.credentialsSafe();
    if (this.disposed || this.generation !== generation) {
      return { code: 'unavailable', message: MESSAGES.unavailable };
    }
    const legacy = legacyToken?.trim();
    if (!service) return legacy ? { token: legacy, source: 'config' } : this.envToken();

    const stored = await this.readSession(service);
    if (stored.error) return { code: 'storage', message: MESSAGES.storage };
    if (!stored.present) return legacy ? { token: legacy, source: 'config' } : this.envToken();
    const session = stored.value;
    if (!session) return { code: 'reauth-required', message: MESSAGES['reauth-required'] };
    if (activeSession(session, this.clock())) return { token: session.accessToken, source: 'oauth' };
    if (!session.refreshToken) return { code: 'reauth-required', message: MESSAGES['reauth-required'] };
    const refreshed = await this.refreshSession(service, undefined, generation);
    if (refreshed.session) return { token: refreshed.session.accessToken, source: 'oauth' };
    const code = refreshed.error?.code;
    const safeCode = code === 'unavailable' || code === 'network' || code === 'invalid-response' || code === 'storage'
      ? code
      : 'reauth-required';
    return { code: safeCode, message: refreshed.error?.message ?? MESSAGES[safeCode] };
  }

  private envToken(): OAuthTokenResolution {
    const token = process.env.APIFY_TOKEN?.trim();
    return token ? { token, source: 'env' } : {};
  }

  private async readSession(
    service: OAuthCredentialsService,
  ): Promise<{ present: boolean; value?: OAuthSession; error?: ApifyOAuthView }> {
    try {
      const records = this.records(service);
      if (records) {
        const record = await records.readRecord(GTFA_APIFY_OAUTH_SESSION_RECORD);
        if (record) return { present: true, value: parseSessionRecord(record) };
      }
      const raw = await service.resolve(GTFA_APIFY_OAUTH_SESSION);
      return raw ? { present: true, value: parseSession(raw.value) } : { present: false };
    } catch {
      return { present: false, error: errorView('storage') };
    }
  }

  private async sessionOnlyView(service: OAuthCredentialsService): Promise<ApifyOAuthView> {
    const stored = await this.readSession(service);
    if (stored.error) return stored.error;
    if (!stored.present) return { available: true, connected: false, pending: false };
    const session = stored.value;
    if (session && activeSession(session, this.clock())) return connectedView();
    return errorView('reauth-required');
  }

  private async refreshViewLocked(
    service: OAuthCredentialsService,
    signal: AbortSignal | undefined,
    description: OAuthCredentialDescription | undefined,
  ): Promise<ApifyOAuthView> {
    if (description?.writable === false) return errorView('read-only');
    const refreshed = await this.refreshSession(service, signal);
    if (refreshed.session) return connectedView();
    return refreshed.error ?? errorView('reauth-required');
  }

  private async refreshSession(
    service: OAuthCredentialsService,
    signal?: AbortSignal,
    generation = this.generation,
  ): Promise<{ session?: OAuthSession; error?: ApifyOAuthView }> {
    const clientIdResult = await this.readClientId(service);
    if (clientIdResult.error) return clientIdResult;
    if (!clientIdResult.clientId) return { error: errorView('reauth-required') };

    const records = this.records(service);
    if (records) {
      let refreshed: OAuthSession | undefined;
      let failure: ApifyOAuthView | undefined;
      let legacyOnly = false;
      try {
        await records.modifyRecord(GTFA_APIFY_OAUTH_SESSION_RECORD, async current => {
          if (!current) {
            legacyOnly = true;
            return current;
          }
          const currentSession = parseSessionRecord(current);
          if (!currentSession) {
            failure = errorView('reauth-required');
            return current;
          }
          if (activeSession(currentSession, this.clock())) {
            refreshed = currentSession;
            return current;
          }
          if (!currentSession.refreshToken) {
            failure = errorView('reauth-required');
            return current;
          }
          const result = await this.requestRefresh(clientIdResult.clientId!, currentSession.refreshToken, signal);
          if (this.disposed || this.generation !== generation) {
            failure = errorView('unavailable', false);
            return current;
          }
          if (result.session) {
            refreshed = result.session;
            return sessionRecord(result.session);
          }
          failure = result.error;
          return current;
        });
      } catch {
        return { error: errorView('storage') };
      }
      if (!legacyOnly) {
        return refreshed ? { session: refreshed } : { error: failure ?? errorView('reauth-required') };
      }
    }

    const stored = await this.readSession(service);
    if (stored.error) return stored;
    const session = stored.value;
    if (!session) return { error: errorView('reauth-required') };
    if (activeSession(session, this.clock())) return { session };
    if (!session.refreshToken) return { error: errorView('reauth-required') };
    const result = await this.requestRefresh(clientIdResult.clientId, session.refreshToken, signal);
    if (!result.session) return { error: result.error };
    if (this.disposed || this.generation !== generation) return { error: errorView('unavailable', false) };
    if (!await this.writeSession(service, result.session, () => this.generation === generation)) {
      return { error: errorView('storage') };
    }
    return { session: result.session };
  }

  private async requestRefresh(
    clientId: string,
    refreshToken: string,
    signal?: AbortSignal,
  ): Promise<{ session?: OAuthSession; error?: ApifyOAuthView }> {
    const result = await this.requestJson(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
    }, signal);
    if (!result.ok) {
      if (result.oauthError === 'invalid_client' || result.oauthError === 'invalid_grant') {
        return { error: errorView('reauth-required') };
      }
      return { error: this.requestErrorView(result) };
    }
    const token = oauthToken(result.body.access_token);
    const tokenType = result.body.token_type;
    if (!token || (tokenType !== undefined && typeof tokenType !== 'string') || (typeof tokenType === 'string' && tokenType.toLowerCase() !== 'bearer')) {
      return { error: errorView('invalid-response') };
    }
    const expiresIn = result.body.expires_in === undefined ? undefined : positiveNumber(result.body.expires_in);
    if (result.body.expires_in !== undefined && !expiresIn) return { error: errorView('invalid-response') };
    const nextRefreshToken = result.body.refresh_token === undefined
      ? refreshToken
      : oauthToken(result.body.refresh_token);
    if (result.body.refresh_token !== undefined && !nextRefreshToken) return { error: errorView('invalid-response') };
    const expiresAt = expiresIn === undefined ? undefined : expiryFrom(this.clock(), expiresIn);
    if (expiresIn !== undefined && !expiresAt) return { error: errorView('invalid-response') };
    const next: OAuthSession = {
      accessToken: token,
      ...(expiresAt ? { expiresAt } : {}),
      ...(nextRefreshToken ? { refreshToken: nextRefreshToken } : {}),
    };
    return { session: next };
  }

  private async pollLocked(service: OAuthCredentialsService, signal?: AbortSignal): Promise<ApifyOAuthView> {
    const pending = this.pending;
    if (!pending) return { available: true, connected: false, pending: false };
    const generation = pending.generation;
    const result = await this.requestJson(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: DEVICE_GRANT,
        device_code: pending.deviceCode,
        client_id: pending.clientId,
      }).toString(),
    }, signal);

    if (this.generation !== generation || this.pending !== pending) return this.sessionOnlyView(service);
    const remoteError = result.ok ? oauthError(result.body) : result.oauthError;
    if (remoteError === 'authorization_pending') {
      pending.nextPollAt = this.clock() + pending.intervalMs;
      return pendingView(pending);
    }
    if (remoteError === 'slow_down') {
      pending.intervalMs += 5000;
      pending.nextPollAt = this.clock() + pending.intervalMs;
      return pendingView(pending);
    }
    if (remoteError === 'access_denied' || remoteError === 'expired_token' ||
      remoteError === 'invalid_client' || remoteError === 'invalid_grant') {
      this.pending = undefined;
      if (remoteError === 'access_denied') return errorView('access-denied');
      if (remoteError === 'expired_token') return errorView('expired');
      return errorView('reauth-required');
    }

    if (!result.ok) {
      const view = this.requestErrorView(result);
      if (view.code === 'network') {
        pending.nextPollAt = this.clock() + pending.intervalMs;
        return pendingView(pending);
      }
      this.pending = undefined;
      return view;
    }

    if (remoteError) {
      this.pending = undefined;
      return errorView('invalid-response');
    }

    const token = oauthToken(result.body.access_token);
    const tokenType = result.body.token_type;
    if (!token || (tokenType !== undefined && typeof tokenType !== 'string') || (typeof tokenType === 'string' && tokenType.toLowerCase() !== 'bearer')) {
      this.pending = undefined;
      return errorView('invalid-response');
    }
    const expiresIn = result.body.expires_in === undefined ? undefined : positiveNumber(result.body.expires_in);
    if (result.body.expires_in !== undefined && !expiresIn) {
      this.pending = undefined;
      return errorView('invalid-response');
    }
    const refreshToken = result.body.refresh_token === undefined ? undefined : oauthToken(result.body.refresh_token);
    if (result.body.refresh_token !== undefined && !refreshToken) {
      this.pending = undefined;
      return errorView('invalid-response');
    }
    const expiresAt = expiresIn === undefined ? undefined : expiryFrom(this.clock(), expiresIn);
    if (expiresIn !== undefined && !expiresAt) {
      this.pending = undefined;
      return errorView('invalid-response');
    }
    const session: OAuthSession = {
      accessToken: token,
      ...(expiresAt ? { expiresAt } : {}),
      ...(refreshToken ? { refreshToken } : {}),
    };
    if (this.generation !== generation || this.pending !== pending) return this.sessionOnlyView(service);
    if (!await this.writeSession(service, session, () => this.generation === generation)) {
      this.pending = undefined;
      return errorView('storage');
    }
    if (this.generation !== generation || this.pending !== pending) {
      await this.deleteSession(service, session);
      return this.sessionOnlyView(service);
    }
    this.pending = undefined;
    return connectedView();
  }

  private async registerClient(
    service: OAuthCredentialsService,
    signal?: AbortSignal,
  ): Promise<{ clientId?: string; error?: ApifyOAuthView }> {
    const metadata = await this.requestJson(METADATA_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
    }, signal);
    if (!metadata.ok) return { error: this.requestErrorView(metadata) };
    if (
      metadata.body.issuer !== ISSUER ||
      !expectedUrl(metadata.body.registration_endpoint, REGISTRATION_ENDPOINT) ||
      !expectedUrl(metadata.body.device_authorization_endpoint, DEVICE_ENDPOINT) ||
      !expectedUrl(metadata.body.token_endpoint, TOKEN_ENDPOINT)
    ) return { error: errorView('invalid-response') };

    const registered = await this.requestJson(REGISTRATION_ENDPOINT, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        grant_types: [DEVICE_GRANT],
        token_endpoint_auth_method: 'none',
      }),
    }, signal);
    if (!registered.ok) return { error: this.requestErrorView(registered) };
    const clientId = opaqueValue(registered.body.client_id);
    return clientId ? { clientId } : { error: errorView('invalid-response') };
  }

  private async deviceAuthorization(clientId: string, signal?: AbortSignal): Promise<RequestResult> {
    return this.requestJson(DEVICE_ENDPOINT, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scope: SCOPE }).toString(),
    }, signal);
  }

  private async readClientId(service: OAuthCredentialsService): Promise<{ clientId?: string; error?: ApifyOAuthView }> {
    try {
      const records = this.records(service);
      if (records) {
        const record = await records.readRecord(GTFA_APIFY_OAUTH_CLIENT_RECORD);
        if (record) return { clientId: parseClientRecord(record) };
      }
      const raw = await service.resolve(GTFA_APIFY_OAUTH_CLIENT_ID);
      return { ...(raw ? { clientId: opaqueValue(raw.value) } : {}) };
    } catch {
      return { error: errorView('storage') };
    }
  }

  private async describeSession(
    service: OAuthCredentialsService,
  ): Promise<{ value?: OAuthCredentialDescription; error?: ApifyOAuthView }> {
    try {
      const records = this.records(service);
      if (records) {
        const description = await records.describeRecord(GTFA_APIFY_OAUTH_SESSION_RECORD);
        return {
          value: {
            configured: description.configured,
            writable: description.writable,
            ...(description.kind ? { source: description.kind } : {}),
          },
        };
      }
      return { value: await service.describe(GTFA_APIFY_OAUTH_SESSION) };
    } catch {
      return { error: errorView('storage') };
    }
  }

  private async writeSession(
    service: OAuthCredentialsService,
    session: OAuthSession,
    guard: () => boolean = () => true,
  ): Promise<boolean> {
    try {
      const records = this.records(service);
      if (records) {
        let wrote = false;
        await records.modifyRecord(GTFA_APIFY_OAUTH_SESSION_RECORD, async current => {
          if (!guard()) return current;
          wrote = true;
          return sessionRecord(session);
        });
        return wrote;
      }
      if (!guard()) return false;
      await service.set(GTFA_APIFY_OAUTH_SESSION, serializeSession(session));
      return true;
    } catch {
      return false;
    }
  }

  private async writeClientId(service: OAuthCredentialsService, clientId: string): Promise<boolean> {
    try {
      const records = this.records(service);
      if (records) {
        await records.modifyRecord(GTFA_APIFY_OAUTH_CLIENT_RECORD, async () => ({
          kind: 'grant',
          payload: clientPayload(clientId),
        }));
      } else {
        await service.set(GTFA_APIFY_OAUTH_CLIENT_ID, clientId);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async deleteSession(service: OAuthCredentialsService, expected?: OAuthSession): Promise<boolean> {
    let ok = true;
    const records = this.records(service);
    if (records) {
      try {
        if (expected) {
          await records.modifyRecord(GTFA_APIFY_OAUTH_SESSION_RECORD, async current => {
            if (!current) return current;
            return parseSessionRecord(current)?.accessToken === expected.accessToken ? undefined : current;
          });
        } else {
          await records.deleteRecord(GTFA_APIFY_OAUTH_SESSION_RECORD);
        }
      } catch {
        ok = false;
      }
    }
    try {
      if (expected) {
        const raw = await service.resolve(GTFA_APIFY_OAUTH_SESSION);
        if (raw && parseSession(raw.value)?.accessToken === expected.accessToken) {
          await service.unset(GTFA_APIFY_OAUTH_SESSION);
        }
      } else {
        await service.unset(GTFA_APIFY_OAUTH_SESSION);
      }
    } catch {
      ok = false;
    }
    return ok;
  }

  private async deleteClientId(service: OAuthCredentialsService): Promise<boolean> {
    let ok = true;
    const records = this.records(service);
    if (records) {
      try {
        await records.deleteRecord(GTFA_APIFY_OAUTH_CLIENT_RECORD);
      } catch {
        ok = false;
      }
    }
    try {
      await service.unset(GTFA_APIFY_OAUTH_CLIENT_ID);
    } catch {
      ok = false;
    }
    return ok;
  }

  private requestErrorView(result: Exclude<RequestResult, { ok: true }>): ApifyOAuthView {
    if (result.code === 'network') return errorView('network');
    return errorView('invalid-response');
  }

  private async requestJson(url: string, init: RequestInit, signal?: AbortSignal): Promise<RequestResult> {
    if (this.disposed) return { ok: false, code: 'network' };
    const request = new AbortController();
    this.requests.add(request);
    const abort = () => request.abort(signal?.reason);
    if (signal?.aborted) request.abort(signal.reason);
    else signal?.addEventListener('abort', abort, { once: true });
    const requestSignal = timeoutSignal(request.signal, this.timeoutMs);
    try {
      const response = await raceAbort(this.fetchImpl(url, {
        ...init,
        redirect: 'error',
        signal: requestSignal,
      }), requestSignal);
      const text = await this.readLimitedText(response, requestSignal);
      if (text === undefined) {
        request.abort();
        return { ok: false, status: response.status, code: 'invalid-response' };
      }
      const body = parseBody(text);
      if (!response.ok) return {
        ok: false,
        status: response.status,
        code: 'invalid-response',
        ...(body && oauthError(body) ? { oauthError: oauthError(body) } : {}),
      };
      return body ? { ok: true, status: response.status, body } : { ok: false, status: response.status, code: 'invalid-response' };
    } catch {
      return { ok: false, code: 'network' };
    } finally {
      signal?.removeEventListener('abort', abort);
      this.requests.delete(request);
    }
  }

  private async readLimitedText(response: Response, signal: AbortSignal): Promise<string | undefined> {
    const declared = response.headers.get('content-length');
    if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_JSON_CHARS) return undefined;
    if (!response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    try {
      while (true) {
        const chunk = await raceAbort(reader.read(), signal);
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > MAX_JSON_CHARS) {
          void reader.cancel().catch(() => {});
          return undefined;
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      return text + decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
}

export function createApifyOAuthManager(options: ApifyOAuthManagerOptions = {}): ApifyOAuthManager {
  return new ApifyOAuthManager(options);
}
