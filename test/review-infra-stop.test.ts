import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter, type Transport } from '../src/transport.js';
import { testConnection } from '../src/dsh-routes.js';

const doctorCalls = vi.hoisted(() => [] as unknown[]);
vi.mock('../src/doctor.js', () => ({
  runDoctor: async (options: unknown) => {
    doctorCalls.push(options);
    return {
      ok: true,
      checks: [],
      summary: { passed: 0, failed: 0 },
      node: { version: 'v20.0.0', required: '>=20' },
      proxy: { source: 'none', url: null, direct: true },
    };
  },
}));

import { runDoctorCli } from '../src/doctor-cli.js';

const TOKEN = 'apify_api_review_secret';

beforeEach(() => {
  doctorCalls.splice(0);
});

describe('reviewed infrastructure stops', () => {
  it('keeps a third request queued when a middle waiter is cancelled behind a running request', async () => {
    const limiter = new RateLimiter({ minIntervalMs: 0 });
    const events: string[] = [];
    let finishFirst!: () => void;
    const first = limiter.run(async () => {
      events.push('A');
      await new Promise<void>(resolve => { finishFirst = resolve; });
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(events).toEqual(['A']);

    const controller = new AbortController();
    const middle = limiter.run(async () => { events.push('B'); }, controller.signal)
      .then(() => null, error => error);
    const third = limiter.run(async () => {
      events.push('C');
    });
    controller.abort();

    expect(await middle).toMatchObject({ name: 'AbortError' });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(events).toEqual(['A']);

    finishFirst();
    await Promise.all([first, third]);
    expect(events).toEqual(['A', 'C']);
  });

  it('preserves request spacing in queue order', async () => {
    let now = 0;
    const starts: number[] = [];
    const limiter = new RateLimiter({
      minIntervalMs: 1000,
      now: () => now,
      sleep: async ms => { now += ms; },
    });
    await Promise.all(Array.from({ length: 3 }, () => limiter.run(async () => {
      starts.push(now);
    })));
    expect(starts).toEqual([0, 1000, 2000]);
  });

  it.each(['local', 'actor-public', 'actor-own'] as const)('rejects challenge responses for %s test connections', async egress => {
    for (const response of [
      { status: 302, headers: { Location: 'https://www.google.com/sorry/index' }, body: '' },
      { status: 200, headers: {}, body: '<html>captcha</html>' },
    ]) {
      const transport: Transport = async () => response;
      const result = await testConnection({
        egress,
        apifyToken: TOKEN,
        apifyActor: 'actor-1',
        localTransport: transport,
        relayTransport: () => transport,
      });
      expect(result).toMatchObject({
        ok: false,
        egress,
        code: 'http',
        status: response.status,
        message: expect.stringContaining('challenge'),
      });
    }
  });

  it.each(['1000', '60000'])('accepts and forwards doctor --timeout %s', async timeout => {
    const result = await runDoctorCli(['--json', '--timeout', timeout]);
    expect(result.code).toBe(0);
    expect(doctorCalls).toEqual([{ timeoutMs: Number(timeout) }]);
  });

  it.each(['999', '60001', '1.5', '1e4', '-1', ''])('rejects doctor --timeout %s with invalid-input semantics', async timeout => {
    const result = await runDoctorCli(['--json', '--timeout', timeout]);
    expect(result.code).toBe(4);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    expect(doctorCalls).toEqual([]);
  });

  it('keeps doctor help usable even when an invalid timeout follows it', async () => {
    const result = await runDoctorCli(['--help', '--json', '--timeout', '999']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).help).toContain('--timeout MS');
    expect(doctorCalls).toEqual([]);
  });
});
