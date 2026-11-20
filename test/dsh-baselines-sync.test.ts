import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MEKA_BASELINES_URL,
  MEKA_BASELINE_VERSION,
  currentMekaBaselineVersion,
  mekaAnchorsFor,
  parseMekaBaselinesJson,
  setActiveMekaBaselines,
} from '../src/dsh-baselines.js';
import { createMekaBaselinesSync } from '../src/dsh-baselines-sync.js';

const samplePayload = (version = '2026-11-25', extraDaily = 12000) => ({
  schemaVersion: 1,
  version,
  searchProperty: 'web',
  category: 0,
  regions: [
    {
      geo: '',
      anchors: [
        {
          term: 'stopwatch',
          dailySearches: 160000,
          validation: { '7d': { pointCount: 168, nonzeroPoints: 168, peak: 80 } },
        },
      ],
    },
    {
      geo: 'US',
      anchors: [
        {
          term: 'psi to bar',
          dailySearches: 480,
          validation: { '7d': { pointCount: 169, nonzeroPoints: 114, peak: 13 } },
        },
        {
          term: 'sudoku',
          dailySearches: extraDaily,
          validation: { '7d': { pointCount: 168, nonzeroPoints: 168, peak: 90 } },
        },
      ],
    },
  ],
});

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'gtfa-baselines-sync-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  setActiveMekaBaselines(null);
  while (tempDirs.length) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('MEKA baselines parser', () => {
  it('parses v1 catalog JSON and derives dailyOnly from 7d nonzero density', () => {
    const parsed = parseMekaBaselinesJson(samplePayload());
    expect(parsed.version).toBe('2026-11-25');
    expect(parsed.anchors).toEqual([
      { geo: '', term: 'stopwatch', dailySearches: 160000, dailyOnly: false },
      { geo: 'US', term: 'psi to bar', dailySearches: 480, dailyOnly: true },
      { geo: 'US', term: 'sudoku', dailySearches: 12000, dailyOnly: false },
    ]);
  });

  it('rejects unsupported schema versions or empty payloads', () => {
    expect(() => parseMekaBaselinesJson({ schemaVersion: 2, version: '2026-11-25', regions: [] })).toThrow();
    expect(() => parseMekaBaselinesJson({ schemaVersion: 1, version: '', regions: [] })).toThrow();
    expect(() => parseMekaBaselinesJson(null)).toThrow();
  });
});

describe('MEKA baselines sync lifecycle', () => {
  it('syncs once on initial install when no local cache exists, then skips network on subsequent boots', async () => {
    const dir = await makeTempDir();
    const fetch1 = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(MEKA_BASELINES_URL);
      return Response.json(samplePayload('2026-11-25', 91000));
    });

    const firstBoot = createMekaBaselinesSync({
      getSnapshotDir: () => dir,
      fetch: fetch1 as unknown as typeof fetch,
      now: () => new Date('2026-11-25T10:00:00.000Z'),
    });
    firstBoot.ensureInitialSync();
    await vi.waitFor(() => expect(fetch1).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(currentMekaBaselineVersion()).toBe('2026-11-25'));

    const cached = JSON.parse(await readFile(join(dir, '.meka-baselines.json'), 'utf8'));
    expect(cached.version).toBe('2026-11-25');
    expect(mekaAnchorsFor('US', 'now 7-d')).toEqual([
      { geo: 'US', term: 'sudoku', dailySearches: 91000, dailyOnly: false },
    ]);

    // Simulate restart: reset in-memory state, boot second instance pointing at the same snapshotDir.
    setActiveMekaBaselines(null);
    expect(currentMekaBaselineVersion()).toBe(MEKA_BASELINE_VERSION);

    const fetch2 = vi.fn(async () => Response.json(samplePayload('2026-12-01', 99000)));
    const secondBoot = createMekaBaselinesSync({
      getSnapshotDir: () => dir,
      fetch: fetch2 as unknown as typeof fetch,
      now: () => new Date('2026-11-26T10:00:00.000Z'),
    });
    secondBoot.ensureInitialSync();
    await vi.waitFor(() => expect(currentMekaBaselineVersion()).toBe('2026-11-25'));
    expect(fetch2).not.toHaveBeenCalled();

    // Subsequent updates happen only on explicit manual sync.
    const manual = await secondBoot.sync();
    expect(fetch2).toHaveBeenCalledTimes(1);
    expect(manual.ok).toBe(true);
    expect(manual.updated).toBe(true);
    expect(manual.status.source).toBe('synced');
    expect(manual.status.version).toBe('2026-12-01');
    expect(currentMekaBaselineVersion()).toBe('2026-12-01');

    // Repeating manual sync with identical remote data reports updated: false.
    const repeat = await secondBoot.sync();
    expect(repeat.ok).toBe(true);
    expect(repeat.updated).toBe(false);
  });

  it('keeps current baselines intact when meka.im is unreachable or returns invalid data', async () => {
    const dir = await makeTempDir();
    const offline = createMekaBaselinesSync({
      getSnapshotDir: () => dir,
      fetch: (async () => { throw new Error('offline'); }) as unknown as typeof fetch,
    });
    const failed = await offline.sync();
    expect(failed.ok).toBe(false);
    expect(failed.code).toBe('network');
    expect(failed.status.source).toBe('bundled');
    expect(failed.status.version).toBe(MEKA_BASELINE_VERSION);

    const invalid = createMekaBaselinesSync({
      getSnapshotDir: () => dir,
      fetch: (async () => Response.json({ schemaVersion: 99 })) as unknown as typeof fetch,
    });
    const badPayload = await invalid.sync();
    expect(badPayload.ok).toBe(false);
    expect(badPayload.code).toBe('invalid');
    expect(badPayload.status.version).toBe(MEKA_BASELINE_VERSION);
  });
});
