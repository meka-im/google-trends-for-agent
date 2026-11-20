export const MEKA_BASELINES_URL = "https://meka.im/data/google-trends-anchors/baselines/v1/index.json";
export const MEKA_BASELINE_VERSION = "2026-11-19";

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

export const MEKA_BASELINES = rows.map(([geo, term, dailySearches, dailyOnly]) => ({ geo, term, dailySearches, dailyOnly: dailyOnly === true }));

export function mekaAnchorsFor(geo: string, time?: string) {
  const region = geo.trim().toUpperCase();
  const daily = time === 'today 1-m' || time === 'today 3-m' || time === 'today 12-m';
  return MEKA_BASELINES.filter(anchor => anchor.geo === region && (time === undefined || daily || !anchor.dailyOnly));
}

export function mekaDefaultAnchor(geo: string, time = 'now 7-d') {
  const anchors = mekaAnchorsFor(geo, time);
  return anchors.at(Math.floor((anchors.length - 1) / 2));
}
