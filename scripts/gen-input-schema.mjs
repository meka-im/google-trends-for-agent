import { readFile, writeFile } from 'node:fs/promises';

// Keep the geo select in .actor/input_schema.json in lockstep with src/geos.ts.
const source = await readFile(new URL('../src/geos.ts', import.meta.url), 'utf8');
const match = source.match(/const codes = '([^']+)'\.split\(' '\)/);
if (!match) throw new Error('Could not find the country code list in src/geos.ts');
const codes = match[1].split(' ');
const names = new Intl.DisplayNames(['en'], { type: 'region' });
const label = code => code === 'KR' ? 'South Korea' : names.of(code) ?? code;

const path = new URL('../.actor/input_schema.json', import.meta.url);
const schema = JSON.parse(await readFile(path, 'utf8'));
schema.properties.geo.enum = ['WORLDWIDE', ...codes];
schema.properties.geo.enumTitles = ['Worldwide', ...codes.map(code => `${label(code)} (${code})`)];
await writeFile(path, `${JSON.stringify(schema, null, 2)}\n`);
console.log(`Updated geo enum with ${codes.length} countries.`);
