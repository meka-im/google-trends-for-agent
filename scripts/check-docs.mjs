import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (/\.md$/i.test(entry.name)) files.push(path);
  }
  return files;
}
const files = [
  ...['README.md', 'README.zh-CN.md', 'AGENTS.md', 'CHANGELOG.md', '.actor/README.md', 'dsh/skill.md']
    .map(path => join(root, path)),
  ...await markdownFiles(join(root, 'docs')),
];
let checked = 0;
for (const file of files) {
  const text = await readFile(file, 'utf8');
  const destinations = [
    ...Array.from(text.matchAll(/!?\[[^\]]*\]\((<?[^\s)]+>?)(?:\s+"[^"]*")?\)/g), match => match[1]),
    ...Array.from(text.matchAll(/(?:href|src|srcset)="([^"]+)"/g), match => match[1].split(/[\s,]/)[0]),
  ];
  for (const destination of destinations) {
    const href = destination.replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) continue;
    const path = decodeURIComponent(href.split(/[?#]/)[0]);
    if (!path) continue;
    const target = resolve(dirname(file), path);
    assert.ok(await stat(target).catch(() => false), `${file}: missing link target ${href}`);
    checked++;
  }
}
for (const language of ['en', 'zh']) {
  const { meta } = JSON.parse(await readFile(join(root, 'locale', `${language}.json`), 'utf8'));
  assert.ok(meta.detail, `locale/${language}.json must declare its detail document`);
  await stat(join(root, meta.detail));
}
console.log(`Checked ${checked} local Markdown/HTML file references and both locale document mappings.`);
