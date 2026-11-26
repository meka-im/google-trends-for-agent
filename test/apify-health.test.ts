import { describe, expect, it, vi } from 'vitest';
import { checkAndRecoverApifyActor } from '../scripts/apify-health.mjs';

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('checkAndRecoverApifyActor', () => {
  it('returns healthy without starting a probe run when notice is NONE', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/actors/QUx4aBkz4QCSchDV4')) {
        return jsonRes({ data: { notice: 'NONE', isDeprecated: false, taggedBuilds: { latest: { buildNumber: '0.3.7' } } } });
      }
      throw new Error(`unexpected ${url}`);
    });
    const result = await checkAndRecoverApifyActor({ fetch: fetchMock, token: '', forceProbe: false });
    expect(result).toEqual({
      ok: true,
      status: 'healthy',
      notice: 'NONE',
      isDeprecated: false,
      latestBuild: '0.3.7',
      recovered: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails cleanly when UNDER_MAINTENANCE is detected without APIFY_TOKEN', async () => {
    const fetchMock = vi.fn(async () => jsonRes({ data: { notice: 'UNDER_MAINTENANCE', isDeprecated: false } }));
    const result = await checkAndRecoverApifyActor({ fetch: fetchMock, token: '' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('needs-token');
    expect(result.notice).toBe('UNDER_MAINTENANCE');
  });

  it('probes, clears notice, and triggers rebuild when UNDER_MAINTENANCE is detected with a token', async () => {
    let notice = 'UNDER_MAINTENANCE';
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (method === 'GET' && url.endsWith('/actors/QUx4aBkz4QCSchDV4')) {
        return jsonRes({ data: { notice, isDeprecated: false, taggedBuilds: { latest: { buildNumber: '0.3.7' } } } });
      }
      if (method === 'POST' && url.includes('/acts/QUx4aBkz4QCSchDV4/runs?')) {
        return jsonRes({ data: { id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' } });
      }
      if (method === 'GET' && url.includes('/datasets/ds-1/items?')) {
        return jsonRes([{ term: 'Sora', status: 'ok' }]);
      }
      if (method === 'PUT' && url.endsWith('/actors/QUx4aBkz4QCSchDV4')) {
        const body = JSON.parse(String(init?.body ?? '{}'));
        notice = body.notice;
        return jsonRes({ data: { notice } });
      }
      if (method === 'POST' && url.includes('/acts/QUx4aBkz4QCSchDV4/builds?')) {
        return jsonRes({ data: { id: 'build-8', status: 'SUCCEEDED' } });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const result = await checkAndRecoverApifyActor({ fetch: fetchMock, token: 'apify_api_test' });
    expect(result).toEqual({
      ok: true,
      status: 'recovered',
      notice: 'NONE',
      runId: 'run-1',
      rebuildStatus: 'SUCCEEDED',
      recovered: true,
    });
    expect(calls).toHaveLength(6);
  });

  it('does not clear UNDER_MAINTENANCE when the live probe fails', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url.endsWith('/actors/QUx4aBkz4QCSchDV4')) {
        return jsonRes({ data: { notice: 'UNDER_MAINTENANCE', isDeprecated: false } });
      }
      if (method === 'POST' && url.includes('/acts/QUx4aBkz4QCSchDV4/runs?')) {
        return jsonRes({ data: { id: 'run-bad', status: 'FAILED', defaultDatasetId: 'ds-bad' } });
      }
      throw new Error(`unexpected ${method} ${url}`);
    });

    const result = await checkAndRecoverApifyActor({ fetch: fetchMock, token: 'apify_api_test' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('probe-failed');
    expect(result.recovered).toBe(false);
  });
});
