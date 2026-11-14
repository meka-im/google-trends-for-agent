import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSheetCsv } from '../src/input.js';
import { TRENDING_GEOS } from '../src/geos.js';
import { runTrendingCli } from '../src/trending-cli.js';

const fixture = readFileSync(new URL('./fixtures/trending/US-24.html', import.meta.url), 'utf8');

function fixtureWith(mutate: (rows: unknown[][]) => void): string {
  const payload = fixture.match(/data\s*:\s*(\[.*\])\s*,\s*sideChannel/s)?.[1];
  if (!payload) throw new Error('fixture has no Trending Now payload');
  const data = JSON.parse(payload) as unknown[];
  mutate(data[1] as unknown[][]);
  return fixture.replace(payload, JSON.stringify(data));
}

function transport(body: string) {
  return async () => ({ status: 200, headers: {}, body });
}

describe('reviewed Trending Now CSV output', () => {
  it('round-trips fixture arrays, quotes, commas, newlines, nulls, and formula text', async () => {
    const body = fixtureWith(rows => {
      rows[0]![12] = ' \uFEFF=SUM(1,2)\r\n"quoted"';
    });
    const result = await runTrendingCli(['--geo', 'US', '--format', 'csv'], { transport: transport(body), minIntervalMs: 0 });
    const [header, ...rows] = parseSheetCsv(result.stdout);

    expect(result.code).toBe(0);
    expect(header).toEqual([
      'geo', 'rank', 'title', 'query', 'volume', 'volumeLabel', 'growthPct', 'categoryIds', 'categories',
      'startedAt', 'endedAt', 'active', 'relatedQueries', 'newsCount', 'errorCode', 'errorMessage',
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.length === header.length)).toBe(true);
    const column = (name: string) => header.indexOf(name);
    expect(rows[0]![column('query')]).toBe('\' \uFEFF=SUM(1,2)\r\n"quoted"');
    expect(JSON.parse(rows[0]![column('categoryIds')]!)).toEqual([4]);
    expect(JSON.parse(rows[0]![column('relatedQueries')]!)).toEqual([
      'patrick stewart',
      'sir patrick stewart',
      'patrick stewart cause of death',
      'lewy body dementia',
      'ian mckellen',
      'professor x',
      'patrick stewart movies',
      'patrick stewart dead',
    ]);
    expect(rows[0]![column('endedAt')]).toBe('');
    expect(result.stdout).toContain('""quoted""');
  });

  it('uses the same CSV encoding for --list-geos', async () => {
    const result = await runTrendingCli(['--list-geos', '--format', 'csv']);
    const [header, ...rows] = parseSheetCsv(result.stdout);
    expect(header).toEqual(['code', 'name']);
    expect(rows).toHaveLength(TRENDING_GEOS.length);
    expect(rows.every(row => row.length === 2)).toBe(true);
  });
});
