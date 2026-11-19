export const MEKA_BASELINES_URL = "https://meka.im/data/google-trends-anchors/baselines/v1/index.json";
export const MEKA_BASELINE_VERSION = "2026-11-19";

// Snapshot of the public v1 catalog, ordered by regional search-volume tier.
const rows: readonly (readonly [geo: string, term: string, dailySearches: number])[] = [
  ["", "decimal to binary", 2400],
  ["", "psi to bar", 9200],
  ["", "word search", 27000],
  ["", "feet to meters", 59000],
  ["", "stopwatch", 160000],
  ["", "sudoku", 440000],
  ["", "netflix", 2800000],
  ["", "tiktok", 4900000],
  ["", "instagram", 16000000],
  ["", "youtube", 46000000],
  ["US", "kph to mph", 1600],
  ["US", "oz to ml", 5300],
  ["US", "word search", 15000],
  ["US", "sudoku", 88000],
  ["US", "youtube music", 200000],
  ["US", "instagram", 990000],
  ["US", "gmail", 2700000],
  ["US", "amazon", 4900000],
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
  ["AU", "kg to lbs", 1600],
  ["AU", "cm to inches", 3100],
  ["AU", "youtube music", 15000],
  ["AU", "netflix", 41000],
  ["AU", "gmail", 210000],
  ["AU", "youtube", 540000],
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
  ["IN", "crossword", 2700],
  ["IN", "alarm clock", 7900],
  ["IN", "solitaire", 22000],
  ["IN", "chess", 72000],
  ["IN", "calculator", 290000],
  ["IN", "speed test", 800000],
  ["IN", "english to hindi", 1200000],
  ["IN", "youtube", 6000000],
];

export const MEKA_BASELINES = rows.map(([geo, term, dailySearches]) => ({ geo, term, dailySearches }));

export function mekaAnchorsFor(geo: string) {
  const region = geo.trim().toUpperCase();
  return MEKA_BASELINES.filter(anchor => anchor.geo === region);
}

export function mekaDefaultAnchor(geo: string) {
  const anchors = mekaAnchorsFor(geo);
  return anchors.at(Math.floor((anchors.length - 1) / 2));
}
