// @vitest-environment jsdom
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EN } from '../src/client/index.js';
import { UpdateBanner, dismissKeyForStatus, resolveUpdateMode } from '../src/client/update-banner.js';
import { createVersionStatusMonitor, extractReleaseHighlights } from '../src/dsh-version.js';
import { QueryHistoryStore } from '../src/query-history.js';
import {
  GTFA_UPGRADE_COMMAND,
  compareSemver,
  describeActorRuntimeDrift,
  type VersionStatusSnapshot,
} from '../src/version-check.js';

const t = (key: string) => EN[key] ?? key;

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gtfa-version-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  cleanup();
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('version-check helpers', () => {
  it('compares semver strings accurately including prereleases', () => {
    expect(compareSemver('0.2.24', '0.2.40')).toBe(-1);
    expect(compareSemver('v0.2.41', '0.2.40')).toBe(1);
    expect(compareSemver('0.2.40', '0.2.40')).toBe(0);
    expect(compareSemver('0.2.40-rc.1', '0.2.40')).toBe(-1);
    expect(compareSemver('not-a-ver', '0.2.40')).toBeNull();
  });

  it('produces direction-aware drift warnings for Actor vs client', () => {
    const actorOld = describeActorRuntimeDrift(
      { version: '0.2.24', baselineCatalogRevision: '2026-11-16' },
      '0.2.40',
      '2026-11-19',
      'actor-own',
    );
    expect(actorOld.status).toBe('actor-behind');
    expect(actorOld.warning).toContain('Your Apify Actor (v0.2.24) is behind client v0.2.40');

    const pluginOld = describeActorRuntimeDrift(
      { version: '0.2.41', baselineCatalogRevision: '2026-11-19' },
      '0.2.40',
      '2026-11-19',
      'actor-public',
    );
    expect(pluginOld.status).toBe('plugin-behind');
    expect(pluginOld.warning).toContain('Client v0.2.40 is behind Apify Actor v0.2.41');

    const aligned = describeActorRuntimeDrift(
      { version: '0.2.40', baselineCatalogRevision: '2026-11-19' },
      '0.2.40',
      '2026-11-19',
      'actor-public',
    );
    expect(aligned.status).toBe('aligned');
    expect(aligned.warning).toBeNull();
  });

  it('extracts up to 3 clean highlights from GitHub release markdown', () => {
    const highlights = extractReleaseHighlights([
      '## Highlights',
      '- Added **3-round** batch calibration for [head terms](https://example.com)',
      '- Added per-client setup guides under `docs/clients/`',
      '- Added DSH version update banner',
      '- Extra fourth bullet ignored',
    ].join('\n'));
    expect(highlights).toEqual([
      'Added 3-round batch calibration for head terms',
      'Added per-client setup guides under docs/clients/',
      'Added DSH version update banner',
    ]);
  });
});

describe('createVersionStatusMonitor', () => {
  it('fetches GitHub release lazily, caches 24h on disk, and tracks actor-own runtime drift', async () => {
    const dir = makeTempDir();
    let nowMs = Date.parse('2026-11-21T12:00:00.000Z');
    const fetchMock = vi.fn(async () => Response.json({
      tag_name: 'v0.2.41',
      html_url: 'https://github.com/meka-im/google-trends-for-agent/releases/tag/v0.2.41',
      published_at: '2026-11-21T10:00:00.000Z',
      body: '- Improved DSH upgrade banner\n- Fixed 3-round calibration',
    }));

    const monitor = createVersionStatusMonitor({
      getSnapshotDir: () => dir,
      fetch: fetchMock as unknown as typeof fetch,
      now: () => new Date(nowMs),
      pluginVersion: '0.2.40',
      baselineCatalogRevision: '2026-11-19',
    });

    // No network calls on construction.
    expect(fetchMock).not.toHaveBeenCalled();

    await monitor.recordActorRuntime('actor-own-123', {
      version: '0.2.24',
      baselineCatalogRevision: '2026-11-16',
    });

    const first = await monitor.status({ egress: 'actor-own', apifyActor: 'actor-own-123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.pluginUpdateAvailable).toBe(true);
    expect(first.latestRelease?.version).toBe('0.2.41');
    expect(first.actorUpdateAvailable).toBe(true);
    expect(first.observedActor?.version).toBe('0.2.24');
    expect(first.checkError).toBeNull();

    // Subsequent read within 24h reuses cache without hitting GitHub.
    nowMs += 60_000;
    const second = await monitor.status({ egress: 'actor-own', apifyActor: 'actor-own-123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.latestRelease?.version).toBe('0.2.41');

    // Clearing Actor runtime after rebuild clears actorUpdateAvailable.
    await monitor.clearActorRuntime('actor-own-123');
    const cleared = await monitor.status({ egress: 'actor-own', apifyActor: 'actor-own-123' });
    expect(cleared.actorUpdateAvailable).toBe(false);
    expect(cleared.observedActor).toBeNull();

    // Explicit refresh hits GitHub again and surfaces rate-limit errors.
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 403 }));
    const failedRefresh = await monitor.status({ egress: 'actor-own', apifyActor: 'actor-own-123', refresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(failedRefresh.checkError).toBe('rate-limited');
    expect(failedRefresh.latestRelease?.version).toBe('0.2.41');
  });

  it('bootstraps outdated personal Actor from existing query history on first open and respects clearActorRuntime', async () => {
    const dir = makeTempDir();
    const store = new QueryHistoryStore(dir);
    await store.save({
      tool: 'trends_compare',
      input: { keywords: ['ChatGPT', 'Claude'], geo: 'US', time: 'now 7-d' },
      result: {
        ok: true,
        status: 'ok',
        meta: {
          fetchedAt: '2026-11-21T10:00:00.000Z',
          actorRuntime: { version: '0.2.24', baselineCatalogRevision: '2026-11-16' },
        },
      },
      source: 'agent',
      egress: 'actor-own',
      defaultGeo: 'US',
      startedAt: Date.parse('2026-11-21T10:00:00.000Z'),
    });

    const fetchMock = vi.fn(async () => Response.json({
      tag_name: 'v0.2.40',
      html_url: 'https://github.com/meka-im/google-trends-for-agent/releases/tag/v0.2.40',
      published_at: '2026-11-21T08:00:00.000Z',
      body: '- Current release',
    }));

    const monitor = createVersionStatusMonitor({
      getSnapshotDir: () => dir,
      fetch: fetchMock as unknown as typeof fetch,
      now: () => new Date('2026-11-21T14:00:00.000Z'),
      pluginVersion: '0.2.40',
      baselineCatalogRevision: '2026-11-19',
    });

    const first = await monitor.status({ egress: 'actor-own', apifyActor: '0QSAYBsCxgHbfADGp' });
    expect(first.actorUpdateAvailable).toBe(true);
    expect(first.observedActor?.version).toBe('0.2.24');

    // After clicking Update my Actor, old history records must not re-trigger the outdated flag.
    await monitor.clearActorRuntime('0QSAYBsCxgHbfADGp');
    const afterClear = await monitor.status({ egress: 'actor-own', apifyActor: '0QSAYBsCxgHbfADGp' });
    expect(afterClear.actorUpdateAvailable).toBe(false);
    expect(afterClear.observedActor).toBeNull();
  });
});

function makeSnapshot(overrides: Partial<VersionStatusSnapshot> = {}): VersionStatusSnapshot {
  return {
    pluginVersion: '0.2.40',
    baselineCatalogRevision: '2026-11-19',
    egress: 'actor-public',
    actorId: 'meka.im~google-trends-for-agent',
    latestRelease: {
      version: '0.2.40',
      tagName: 'v0.2.40',
      url: 'https://github.com/meka-im/google-trends-for-agent/releases/tag/v0.2.40',
      publishedAt: '2026-11-21T08:00:00.000Z',
      highlights: [],
    },
    pluginUpdateAvailable: false,
    observedActor: null,
    actorUpdateAvailable: false,
    checkedAt: '2026-11-21T12:00:00.000Z',
    checkError: null,
    ...overrides,
  };
}

describe('UpdateBanner UI', () => {
  it('stays hidden on Dashboard when up-to-date and shows compact bar on Settings', () => {
    const status = makeSnapshot();
    const { container } = render(<UpdateBanner surface="dashboard" status={status} t={t} clientVersion="0.2.40" />);
    expect(container.firstChild).toBeNull();

    const onCheck = vi.fn();
    render(<UpdateBanner surface="settings" status={status} t={t} clientVersion="0.2.40" onCheckUpdates={onCheck} />);
    expect(screen.getByText(t('updateUpToDateTitle'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('updateCheckNow') }));
    expect(onCheck).toHaveBeenCalledTimes(1);
  });

  it('shows expandable upgrade command drawer and dismiss control for plugin updates', () => {
    const status = makeSnapshot({
      pluginUpdateAvailable: true,
      latestRelease: {
        version: '0.2.41',
        tagName: 'v0.2.41',
        url: 'https://github.com/meka-im/google-trends-for-agent/releases/tag/v0.2.41',
        publishedAt: '2026-11-21T12:00:00.000Z',
        highlights: ['3-round batch calibration for head terms'],
      },
    });
    const onDismiss = vi.fn();
    render(<UpdateBanner surface="dashboard" status={status} t={t} clientVersion="0.2.40" onDismiss={onDismiss} />);

    expect(screen.getByText('v0.2.40 → v0.2.41')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('updateShowSteps') }));
    expect(screen.getByText(GTFA_UPGRADE_COMMAND)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: t('updateDismiss') }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows directional actions when personal Actor is behind plugin', () => {
    const status = makeSnapshot({
      egress: 'actor-own',
      actorId: '0QSAYBsCxgHbfADGp',
      actorUpdateAvailable: true,
      observedActor: {
        actorId: '0QSAYBsCxgHbfADGp',
        version: '0.2.24',
        baselineCatalogRevision: '2026-11-16',
        observedAt: '2026-11-21T12:00:00.000Z',
      },
    });
    const onUpdateActor = vi.fn();
    const onSwitchPublic = vi.fn();
    render(<UpdateBanner
      surface="settings"
      status={status}
      t={t}
      clientVersion="0.2.40"
      onUpdateActor={onUpdateActor}
      onSwitchPublic={onSwitchPublic}
    />);

    expect(screen.getByText(t('updateActorOldTitle'))).toBeTruthy();
    expect(screen.getByText('Actor v0.2.24 · Plugin v0.2.40')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('updateActorAction') }));
    fireEvent.click(screen.getByRole('button', { name: t('updateSwitchPublic') }));
    expect(onUpdateActor).toHaveBeenCalledTimes(1);
    expect(onSwitchPublic).toHaveBeenCalledTimes(1);
  });

  it('prioritizes restart-needed over other banners and ignores dismiss', () => {
    const status = makeSnapshot({ pluginVersion: '0.2.40' });
    expect(resolveUpdateMode(status, '0.2.41')).toBe('restart-needed');
    expect(dismissKeyForStatus(status, 'restart-needed', null)).toBeNull();
    render(<UpdateBanner surface="dashboard" status={status} t={t} clientVersion="0.2.41" dismissed />);
    expect(screen.getByText(t('updateRestartTitle'))).toBeTruthy();
  });
});
