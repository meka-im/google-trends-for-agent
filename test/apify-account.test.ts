import { describe, expect, it, vi } from 'vitest';
import { ApifyAccountClient, createApifyAccountClient } from '../src/apify-account.js';

const TOKEN = 'apify_api_test_secret_token';
const LIMITS_URL = 'https://api.apify.com/v2/users/me/limits';
const ME_URL = 'https://api.apify.com/v2/users/me';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function limitsBody(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      monthlyUsageCycle: { startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-01-31T23:59:59.999Z' },
      limits: { maxMonthlyUsageUsd: 19, maxMonthlyResidentialProxyGbytes: 5 },
      current: { monthlyUsageUsd: 8.06, monthlyResidentialProxyGbytes: 0.006 },
      ...overrides,
    },
  };
}

function meBody(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      username: 'private-user',
      email: 'private@example.test',
      proxy: { password: 'private-proxy-password' },
      plan: { tier: 'BRONZE', monthlyBasePriceUsd: 19, monthlyUsageCreditsUsd: 19 },
      ...overrides,
    },
  };
}

function fetchFor(limits: () => Response, me: () => Response) {
  return vi.fn(async (url: string | URL | Request) => String(url).endsWith('/limits') ? limits() : me());
}

describe('Apify account usage client', () => {
  it('maps only the documented plan and usage fields and drops account secrets', async () => {
    const fetchMock = fetchFor(() => json(limitsBody()), () => json(meBody()));
    const now = Date.UTC(2026, 0, 15, 12, 34);
    const client = createApifyAccountClient({ fetch: fetchMock as unknown as typeof fetch, now: () => now });
    const result = await client.usage({ token: TOKEN, source: 'config' });

    expect(result).toEqual({
      ok: true,
      source: 'config',
      plan: { tier: 'BRONZE', monthlyBasePriceUsd: 19, monthlyUsageCreditsUsd: 19 },
      usageUsd: 8.06,
      limitUsd: 19,
      cycle: { startAt: '2026-01-01T00:00:00.000Z', endAt: '2026-01-31T23:59:59.999Z' },
      residentialGb: 0.006,
      residentialGbLimit: 5,
      fetchedAt: new Date(now).toISOString(),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([LIMITS_URL, ME_URL]);
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain('private-proxy-password');
    expect(serialized).not.toContain('private@example.test');
    expect(serialized).not.toContain('private-user');
  });

  it('maps 401 and 403 to invalid-token without calling the second endpoint or leaking the token', async () => {
    for (const status of [401, 403]) {
      const fetchMock = vi.fn(async () => json({ error: { message: TOKEN } }, status));
      const result = await new ApifyAccountClient({ fetch: fetchMock as unknown as typeof fetch }).usage({ token: TOKEN, source: 'env' });
      expect(result).toMatchObject({ ok: false, code: 'invalid-token', status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    }
  });

  it('returns null for missing fields instead of inventing numbers', async () => {
    const fetchMock = fetchFor(
      () => json({ data: { limits: { maxMonthlyUsageUsd: null } } }),
      () => json({ data: { plan: { tier: 'GOLD' } } }),
    );
    const result = await new ApifyAccountClient({ fetch: fetchMock as unknown as typeof fetch }).usage({ token: TOKEN, source: 'config' });
    expect(result).toMatchObject({
      ok: true,
      plan: { tier: 'GOLD', monthlyBasePriceUsd: null, monthlyUsageCreditsUsd: null },
      usageUsd: null,
      limitUsd: null,
      cycle: { startAt: null, endAt: null },
      residentialGb: null,
      residentialGbLimit: null,
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('caches successful results for 60 s, refreshes on demand, and invalidates on token change', async () => {
    let now = 1_000;
    const fetchMock = fetchFor(() => json(limitsBody()), () => json(meBody()));
    const client = new ApifyAccountClient({ fetch: fetchMock as unknown as typeof fetch, now: () => now });

    const first = await client.usage({ token: TOKEN, source: 'config' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const cached = await client.usage({ token: TOKEN, source: 'config' });
    expect(cached).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    now += 61_000;
    await client.usage({ token: TOKEN, source: 'config' });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const refreshed = await client.usage({ token: TOKEN, source: 'config', refresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(refreshed).toMatchObject({ ok: true });

    await client.usage({ token: `${TOKEN}_other`, source: 'config' });
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it('reports network and HTTP failures without leaking the token', async () => {
    const network = vi.fn(async () => { throw new Error(`socket closed for ${TOKEN}`); });
    const networkResult = await new ApifyAccountClient({ fetch: network as unknown as typeof fetch }).usage({ token: TOKEN, source: 'config' });
    expect(networkResult).toMatchObject({ ok: false, code: 'network' });
    expect(JSON.stringify(networkResult)).not.toContain(TOKEN);

    const http = vi.fn(async () => json({ error: TOKEN }, 500));
    const httpResult = await new ApifyAccountClient({ fetch: http as unknown as typeof fetch }).usage({ token: TOKEN, source: 'config' });
    expect(httpResult).toMatchObject({ ok: false, code: 'http', status: 500 });
    expect(JSON.stringify(httpResult)).not.toContain(TOKEN);
  });

  it('returns no-token without making a request', async () => {
    const fetchMock = vi.fn();
    const result = await new ApifyAccountClient({ fetch: fetchMock as unknown as typeof fetch }).usage({ token: '   ', source: 'config' });
    expect(result).toMatchObject({ ok: false, code: 'no-token' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
