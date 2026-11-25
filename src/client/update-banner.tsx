import { useEffect, useState } from 'react';
import { Icon } from './icons.js';
import type { EgressMode } from '../options.js';
import {
  GTFA_RELEASES_URL,
  GTFA_UPGRADE_COMMAND,
  compareSemver,
  parseVersionStatus,
  type VersionStatusSnapshot,
} from '../version-check.js';

declare const __GTFA_CLIENT_VERSION__: string | undefined;

export const CLIENT_VERSION: string | null = typeof __GTFA_CLIENT_VERSION__ === 'string' && __GTFA_CLIENT_VERSION__
  ? __GTFA_CLIENT_VERSION__ : null;

export const VERSION_URL = 'api/gtfa.version';
const DISMISS_STORAGE_KEY = 'gtfa.update.dismissed.1';

type Translate = (key: string) => string;

export type UpdateBannerMode = 'restart-needed' | 'both-outdated' | 'plugin-update' | 'actor-outdated' | 'up-to-date';

function template(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

export async function loadVersionStatus(refresh = false, signal?: AbortSignal): Promise<VersionStatusSnapshot | null> {
  try {
    const response = await fetch(refresh ? `${VERSION_URL}?refresh=1` : VERSION_URL, {
      method: 'GET',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal,
    });
    if (!response.ok) return null;
    const raw = await response.json();
    return parseVersionStatus(raw);
  } catch {
    return null;
  }
}

export async function acknowledgeActorRebuilt(actorId: string, signal?: AbortSignal): Promise<VersionStatusSnapshot | null> {
  try {
    const response = await fetch(VERSION_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'actor-rebuilt', actorId }),
      signal,
    });
    if (!response.ok) return null;
    return parseVersionStatus(await response.json());
  } catch {
    return null;
  }
}

export function readDismissedUpdateKey(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(DISMISS_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeDismissedUpdateKey(key: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    if (key === null) window.localStorage.removeItem(DISMISS_STORAGE_KEY);
    else window.localStorage.setItem(DISMISS_STORAGE_KEY, key);
  } catch {
    /* Storage is optional. */
  }
}

export function effectiveUpdateFlags(
  status: VersionStatusSnapshot,
  egressOverride?: EgressMode,
  actorIdOverride?: string,
): { pluginUpdate: boolean; actorUpdate: boolean; targetPluginVersion: string | null } {
  const egress = egressOverride ?? status.egress;
  const targetPluginVersion = status.latestRelease && (compareSemver(status.latestRelease.version, status.pluginVersion) ?? 0) > 0
    ? status.latestRelease.version
    : status.egress === 'actor-public' && status.observedActor && (compareSemver(status.observedActor.version, status.pluginVersion) ?? 0) > 0
      ? status.observedActor.version
      : null;
  const pluginUpdate = Boolean(targetPluginVersion) || status.pluginUpdateAvailable;

  let actorUpdate = status.actorUpdateAvailable;
  if (egressOverride !== undefined || actorIdOverride !== undefined) {
    if (egress !== 'actor-own') {
      actorUpdate = false;
    } else if (actorIdOverride !== undefined && status.observedActor && actorIdOverride.trim() !== status.observedActor.actorId) {
      actorUpdate = false;
    }
  }
  return { pluginUpdate, actorUpdate, targetPluginVersion };
}

export function resolveUpdateMode(
  status: VersionStatusSnapshot,
  clientVersion: string | null = CLIENT_VERSION,
  egressOverride?: EgressMode,
  actorIdOverride?: string,
): UpdateBannerMode {
  if (clientVersion && status.pluginVersion && clientVersion !== status.pluginVersion) {
    return 'restart-needed';
  }
  const { pluginUpdate, actorUpdate } = effectiveUpdateFlags(status, egressOverride, actorIdOverride);
  if (pluginUpdate && actorUpdate) return 'both-outdated';
  if (pluginUpdate) return 'plugin-update';
  if (actorUpdate) return 'actor-outdated';
  return 'up-to-date';
}

export function dismissKeyForStatus(
  status: VersionStatusSnapshot,
  mode: UpdateBannerMode,
  targetPluginVersion: string | null,
): string | null {
  if (mode === 'up-to-date' || mode === 'restart-needed') return null;
  const parts: string[] = [];
  if (mode === 'plugin-update' || mode === 'both-outdated') {
    parts.push(`plugin:${targetPluginVersion ?? status.latestRelease?.version ?? 'newer'}`);
  }
  if ((mode === 'actor-outdated' || mode === 'both-outdated') && status.observedActor) {
    parts.push(`actor:${status.observedActor.actorId}:${status.observedActor.version}:${status.observedActor.baselineCatalogRevision}`);
  }
  return parts.length ? parts.join('|') : null;
}

export function UpdateBanner({
  surface,
  status,
  t,
  locale = 'en',
  clientVersion = CLIENT_VERSION,
  egressOverride,
  actorIdOverride,
  checking = false,
  updatingActor = false,
  dismissed = false,
  onDismiss,
  onCheckUpdates,
  onUpdateActor,
  onSwitchPublic,
}: {
  surface: 'dashboard' | 'settings';
  status: VersionStatusSnapshot | null;
  t: Translate;
  locale?: string;
  clientVersion?: string | null;
  egressOverride?: EgressMode;
  actorIdOverride?: string;
  checking?: boolean;
  updatingActor?: boolean;
  dismissed?: boolean;
  onDismiss?: () => void;
  onCheckUpdates?: () => void;
  onUpdateActor?: () => void;
  onSwitchPublic?: () => void;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!status) return null;

  const mode = resolveUpdateMode(status, clientVersion, egressOverride, actorIdOverride);
  const { targetPluginVersion } = effectiveUpdateFlags(status, egressOverride, actorIdOverride);

  if (surface === 'dashboard') {
    if (mode === 'up-to-date') return null;
    if (dismissed && mode !== 'restart-needed') return null;
  }

  const releaseUrl = status.latestRelease?.url ?? GTFA_RELEASES_URL;
  const nextVersion = targetPluginVersion ?? status.latestRelease?.version ?? '';
  const actorVer = status.observedActor?.version ?? '';
  const checkedLabel = status.checkedAt
    ? new Date(status.checkedAt).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  const copyCommand = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(GTFA_UPGRADE_COMMAND);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const pendingPublicSwitch = surface === 'settings'
    && status.egress === 'actor-own'
    && egressOverride === 'actor-public';

  if (mode === 'up-to-date') {
    return <aside className="gtfa-update-banner neutral" aria-label={t('updateUpToDateTitle')}>
      <div className="gtfa-update-row">
        <span className="gtfa-update-icon"><Icon name="check" size={14} /></span>
        <div className="gtfa-update-copy">
          <div className="gtfa-update-title">
            <span>{t('updateUpToDateTitle')}</span>
            <span className="gtfa-ver-pill ok">v{status.pluginVersion}</span>
            {pendingPublicSwitch ? <span className="gtfa-ver-pill warn">{t('updatePendingSave')}</span> : null}
          </div>
          <p className="gtfa-update-sub">
            {pendingPublicSwitch
              ? t('updateSwitchedPublicUnsaved')
              : template(t('updateUpToDateSub'), {
                catalog: status.baselineCatalogRevision,
                checked: checkedLabel ?? t('updateNotChecked'),
              })}
          </p>
        </div>
        {onCheckUpdates ? <div className="gtfa-update-actions">
          <button type="button" className="gtfa-update-btn" disabled={checking} onClick={onCheckUpdates}>
            <span className={checking ? 'gtfa-spin' : undefined}><Icon name="refresh" size={12} /></span>
            {checking ? t('updateChecking') : t('updateCheckNow')}
          </button>
        </div> : null}
      </div>
      {status.checkError ? <p className="gtfa-update-feedback" role="status">
        {t(status.checkError === 'rate-limited' ? 'updateCheckRateLimited' : 'updateCheckFailed')}
      </p> : null}
    </aside>;
  }

  if (mode === 'restart-needed') {
    return <aside className="gtfa-update-banner warn" role="status">
      <div className="gtfa-update-row">
        <span className="gtfa-update-icon"><Icon name="alert" size={14} /></span>
        <div className="gtfa-update-copy">
          <div className="gtfa-update-title">
            <span>{t('updateRestartTitle')}</span>
            <span className="gtfa-ver-pill warn">v{status.pluginVersion} → v{clientVersion}</span>
          </div>
          <p className="gtfa-update-sub">
            {template(t('updateRestartSub'), { backend: status.pluginVersion, frontend: clientVersion ?? '' })}
          </p>
        </div>
      </div>
    </aside>;
  }

  if (mode === 'actor-outdated') {
    return <aside className="gtfa-update-banner warn" role="status">
      <div className="gtfa-update-row">
        <span className="gtfa-update-icon"><Icon name="alert" size={14} /></span>
        <div className="gtfa-update-copy">
          <div className="gtfa-update-title">
            <span>{t('updateActorOldTitle')}</span>
            <span className="gtfa-ver-pill warn">
              {template(t('updateActorOldPill'), { actor: actorVer, latest: targetPluginVersion ?? status.pluginVersion })}
            </span>
          </div>
          <p className="gtfa-update-sub">{t('updateActorOldSub')}</p>
        </div>
        <div className="gtfa-update-actions">
          {onUpdateActor ? <button type="button" className="gtfa-update-btn primary" disabled={updatingActor} onClick={onUpdateActor}>
            <span className={updatingActor ? 'gtfa-spin' : undefined}><Icon name="refresh" size={12} /></span>
            {updatingActor ? t('actorUpdatingTitle') : t('updateActorAction')}
          </button> : null}
          {onSwitchPublic ? <button type="button" className="gtfa-update-btn" disabled={updatingActor} onClick={onSwitchPublic}>
            {t('updateSwitchPublic')}
          </button> : null}
          {surface === 'settings' && onCheckUpdates ? <button type="button" className="gtfa-update-btn ghost icon-only"
            disabled={checking} aria-label={t('updateCheckNow')} title={t('updateCheckNow')} onClick={onCheckUpdates}>
            <span className={checking ? 'gtfa-spin' : undefined}><Icon name="refresh" size={12} /></span>
          </button> : null}
          {surface === 'dashboard' && onDismiss ? <button type="button" className="gtfa-update-btn ghost icon-only"
            aria-label={t('updateDismiss')} title={t('updateDismiss')} onClick={onDismiss}>
            <Icon name="close" size={13} />
          </button> : null}
        </div>
      </div>
    </aside>;
  }

  const isBoth = mode === 'both-outdated';
  const highlights = status.latestRelease?.highlights ?? [];

  return <aside className={`gtfa-update-banner${isBoth ? ' warn' : ''}`} role="status">
    <div className="gtfa-update-row">
      <span className="gtfa-update-icon"><Icon name={isBoth ? 'alert' : 'upload'} size={14} /></span>
      <div className="gtfa-update-copy">
        <div className="gtfa-update-title">
          <span>{t(isBoth ? 'updateBothTitle' : 'updatePluginTitle')}</span>
          {nextVersion ? <span className={`gtfa-ver-pill${isBoth ? ' warn' : ''}`}>v{status.pluginVersion} → v{nextVersion}</span> : null}
          {isBoth && actorVer ? <span className="gtfa-ver-pill warn">Actor v{actorVer}</span> : null}
        </div>
        <p className="gtfa-update-sub">
          {isBoth
            ? template(t('updateBothSub'), { next: nextVersion || status.pluginVersion })
            : highlights[0] ?? t('updatePluginSubFallback')}
        </p>
      </div>
      <div className="gtfa-update-actions">
        <button type="button" className="gtfa-update-btn primary"
          aria-expanded={drawerOpen} onClick={() => setDrawerOpen(open => !open)}>
          {t(drawerOpen ? 'updateHideSteps' : 'updateShowSteps')}
        </button>
        {isBoth && onUpdateActor ? <button type="button" className="gtfa-update-btn" disabled={updatingActor} onClick={onUpdateActor}>
          <span className={updatingActor ? 'gtfa-spin' : undefined}><Icon name="refresh" size={12} /></span>
          {t('updateActorAction')}
        </button> : <a className="gtfa-update-btn" href={releaseUrl} target="_blank" rel="noopener noreferrer">
          {t('updateReleaseNotes')}
        </a>}
        {surface === 'settings' && onCheckUpdates ? <button type="button" className="gtfa-update-btn ghost icon-only"
          disabled={checking} aria-label={t('updateCheckNow')} title={t('updateCheckNow')} onClick={onCheckUpdates}>
          <span className={checking ? 'gtfa-spin' : undefined}><Icon name="refresh" size={12} /></span>
        </button> : null}
        {surface === 'dashboard' && onDismiss ? <button type="button" className="gtfa-update-btn ghost icon-only"
          aria-label={t('updateDismiss')} title={t('updateDismiss')} onClick={onDismiss}>
          <Icon name="close" size={13} />
        </button> : null}
      </div>
    </div>
    {drawerOpen ? <div className="gtfa-update-drawer">
      {highlights.length > 0 ? <ul className="gtfa-update-highlights">
        {highlights.map((line, index) => <li key={index}>{line}</li>)}
      </ul> : null}
      <div className="gtfa-update-cmd">
        <code>{GTFA_UPGRADE_COMMAND}</code>
        <button type="button" className={`gtfa-update-btn${copied ? ' primary' : ''}`} onClick={() => { void copyCommand(); }}>
          <Icon name={copied ? 'check' : 'copy'} size={12} />
          {t(copied ? 'updateCopied' : 'updateCopyCmd')}
        </button>
      </div>
      <div className="gtfa-update-drawer-foot">
        <span>{t('updateRestartHint')}</span>
        <a href={releaseUrl} target="_blank" rel="noopener noreferrer">{t('updateReleaseNotes')}</a>
      </div>
    </div> : null}
  </aside>;
}
