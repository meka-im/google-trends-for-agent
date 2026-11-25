export const MEKA_BASELINES_URL = "https://meka.im/data/google-trends-anchors/baselines/v1/index.json";
export const MEKA_BASELINE_VERSION = "2026-11-19";

export interface MekaAnchor {
  geo: string;
  term: string;
  dailySearches: number;
  dailyOnly: boolean;
}

export interface MekaCatalogState {
  source: 'bundled' | 'synced';
  version: string;
  syncedAt: string | null;
  anchors: readonly MekaAnchor[];
}

export interface MekaBaselineStatus extends MekaCatalogState {
  bundledVersion: string;
  regions: readonly string[];
  count: number;
}

// Snapshot of the published v1 catalog. The optional flag marks anchors that
// failed the 7-day hourly quality check and require daily or coarser buckets.
const rows: readonly (readonly [geo: string, term: string, dailySearches: number, dailyOnly?: true])[] = [
  ["", "inches to yards", 1100],
  ["", "psi to bar", 9200],
  ["", "word search", 27000],
  ["", "feet to meters", 59000],
  ["", "stopwatch", 160000],
  ["", "sudoku", 440000],
  ["", "netflix", 2800000],
  ["", "tiktok", 4900000],
  ["", "instagram", 16000000],
  ["", "youtube", 46000000],
  ["US", "psi to bar", 480, true],
  ["US", "kph to mph", 1600],
  ["US", "oz to ml", 5300],
  ["US", "word search", 15000],
  ["US", "sudoku", 88000],
  ["US", "youtube music", 200000],
  ["US", "instagram", 990000],
  ["US", "gmail", 2700000],
  ["US", "amazon", 4900000],
  ["CA", "psi to kpa", 390, true],
  ["CA", "inches to mm", 2800],
  ["CA", "km to miles", 3500],
  ["CA", "sudoku", 15000],
  ["CA", "speed test", 48000],
  ["CA", "instagram", 140000],
  ["CA", "amazon", 380000],
  ["GB", "inches to feet", 870],
  ["GB", "word search", 2900],
  ["GB", "miles to km", 5500],
  ["GB", "crossword solver", 27000],
  ["GB", "solitaire", 72000],
  ["GB", "calculator", 160000],
  ["GB", "facebook", 820000],
  ["GB", "youtube", 1500000],
  ["DE", "zoll in mm", 540, true],
  ["DE", "fahrenheit in celsius", 1100],
  ["DE", "cm in zoll", 4400],
  ["DE", "Kreuzworträtsel", 22000],
  ["DE", "Sudoku", 39000],
  ["DE", "speedtest", 160000],
  ["DE", "google maps", 360000],
  ["DE", "youtube", 1500000],
  ["FR", "cm en pouces", 270],
  ["FR", "synonymes", 600],
  ["FR", "taux de change", 1100],
  ["FR", "mots fléchés", 4400],
  ["FR", "sudoku", 22000],
  ["FR", "solitaire", 59000],
  ["FR", "instagram", 240000],
  ["FR", "facebook", 980000],
  ["FR", "youtube", 1500000],
  ["JP", "目覚まし", 770],
  ["JP", "囲碁", 2900],
  ["JP", "時刻", 4500],
  ["JP", "テトリス", 18000],
  ["JP", "タイマー", 39000],
  ["JP", "電卓", 160000],
  ["JP", "翻訳", 700000],
  ["JP", "youtube", 1500000],
];

export const MEKA_BASELINES: readonly MekaAnchor[] = rows.map(([geo, term, dailySearches, dailyOnly]) => ({
  geo, term, dailySearches, dailyOnly: dailyOnly === true,
}));

const BUNDLED_CATALOG: MekaCatalogState = {
  source: 'bundled',
  version: MEKA_BASELINE_VERSION,
  syncedAt: null,
  anchors: MEKA_BASELINES,
};

let activeCatalog: MekaCatalogState = BUNDLED_CATALOG;

export function getActiveMekaBaselines(): MekaCatalogState {
  return activeCatalog;
}

export function currentMekaBaselineVersion(): string {
  return activeCatalog.version;
}

export function setActiveMekaBaselines(next: MekaCatalogState | null): MekaCatalogState {
  activeCatalog = next && next.anchors.length > 0 ? {
    source: next.source,
    version: next.version,
    syncedAt: next.syncedAt,
    anchors: [...next.anchors],
  } : BUNDLED_CATALOG;
  return activeCatalog;
}

export function summarizeMekaCatalog(state: MekaCatalogState = activeCatalog): MekaBaselineStatus {
  const seen = new Set<string>();
  const regions: string[] = [];
  for (const anchor of state.anchors) {
    if (!seen.has(anchor.geo)) {
      seen.add(anchor.geo);
      regions.push(anchor.geo);
    }
  }
  return {
    source: state.source,
    version: state.version,
    bundledVersion: MEKA_BASELINE_VERSION,
    syncedAt: state.syncedAt,
    anchors: state.anchors,
    regions,
    count: state.anchors.length,
  };
}

/** Validate and flatten the published MEKA v1 baselines index JSON. */
export function parseMekaBaselinesJson(raw: unknown): { version: string; anchors: MekaAnchor[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('MEKA baselines payload must be a JSON object.');
  }
  const doc = raw as Record<string, unknown>;
  if (doc.schemaVersion !== 1) {
    throw new Error(`Unsupported MEKA baselines schemaVersion: ${String(doc.schemaVersion)}`);
  }
  const version = typeof doc.version === 'string' ? doc.version.trim() : '';
  if (!version || version.length > 64) {
    throw new Error('MEKA baselines version must be a non-empty string.');
  }
  if (!Array.isArray(doc.regions) || doc.regions.length === 0) {
    throw new Error('MEKA baselines regions must be a non-empty array.');
  }
  const anchors: MekaAnchor[] = [];
  const seen = new Set<string>();
  for (const regionValue of doc.regions) {
    if (!regionValue || typeof regionValue !== 'object' || Array.isArray(regionValue)) {
      throw new Error('MEKA baselines region entry must be an object.');
    }
    const region = regionValue as Record<string, unknown>;
    if (typeof region.geo !== 'string') {
      throw new Error('MEKA baselines region geo must be a string.');
    }
    const geo = region.geo.trim().toUpperCase();
    if (geo !== '' && !/^[A-Z]{2}$/.test(geo)) {
      throw new Error(`Invalid MEKA baselines region geo: ${geo}`);
    }
    if (!Array.isArray(region.anchors)) {
      throw new Error(`MEKA baselines anchors for "${geo || 'Worldwide'}" must be an array.`);
    }
    for (const itemValue of region.anchors) {
      if (!itemValue || typeof itemValue !== 'object' || Array.isArray(itemValue)) continue;
      const item = itemValue as Record<string, unknown>;
      const term = typeof item.term === 'string' ? item.term.trim() : '';
      const dailySearches = typeof item.dailySearches === 'number' && Number.isFinite(item.dailySearches) && item.dailySearches > 0
        ? Math.round(item.dailySearches) : null;
      if (!term || term.length > 160 || dailySearches === null) continue;
      const key = `${geo}\u0000${term.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const validation = item.validation && typeof item.validation === 'object' && !Array.isArray(item.validation)
        ? (item.validation as Record<string, unknown>)['7d'] : undefined;
      const v7 = validation && typeof validation === 'object' && !Array.isArray(validation)
        ? validation as Record<string, unknown> : undefined;
      const points = typeof v7?.pointCount === 'number' ? v7.pointCount : 0;
      const nonzero = typeof v7?.nonzeroPoints === 'number' ? v7.nonzeroPoints : 0;
      const dailyOnly = item.dailyOnly === true || !(points > 0) || (nonzero / points) < 0.8;
      anchors.push({ geo, term, dailySearches, dailyOnly });
      if (anchors.length > 2000) {
        throw new Error('MEKA baselines payload exceeds maximum anchor limit.');
      }
    }
  }
  if (anchors.length === 0) {
    throw new Error('MEKA baselines payload contained no valid anchors.');
  }
  return { version, anchors };
}

export function mekaAnchorsFor(geo: string, time?: string, catalog: readonly MekaAnchor[] = activeCatalog.anchors) {
  const region = geo.trim().toUpperCase();
  const daily = time === 'today 1-m' || time === 'today 3-m' || time === 'today 12-m';
  return catalog.filter(anchor => anchor.geo === region && (time === undefined || daily || !anchor.dailyOnly));
}

export function mekaDefaultAnchor(geo: string, time = 'now 7-d', catalog: readonly MekaAnchor[] = activeCatalog.anchors) {
  const anchors = mekaAnchorsFor(geo, time, catalog);
  return anchors.at(Math.floor((anchors.length - 1) / 2));
}
