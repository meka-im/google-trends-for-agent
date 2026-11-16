import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temporary = await mkdtemp(join(tmpdir(), 'gtfa-package-'));
const run = (command, args, cwd = temporary) => execFileSync(command, args, {
  cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
});
try {
  const [packed] = JSON.parse(run(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], root));
  const paths = new Set(packed.files.map(file => file.path));
  for (const path of ['dist/index.js', 'dist/dsh-client.js', 'dsh/skill.md', 'icon.svg',
    'locale/en.json', 'locale/zh.json', 'README.md', 'README.zh-CN.md']) assert.ok(paths.has(path), `Missing package file: ${path}`);
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ name: 'gtfa-consumer-check', private: true, type: 'module' }));
  run(npm, ['install', '--ignore-scripts', '--omit=dev', '--no-fund', '--no-audit', join(temporary, packed.filename)]);
  const installed = join(temporary, 'node_modules', 'google-trends-for-agent');
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  for (const [language, document] of [['en', 'README.md'], ['zh', 'README.zh-CN.md']]) {
    const locale = JSON.parse(await readFile(join(installed, 'locale', `${language}.json`), 'utf8'));
    assert.equal(locale.meta.detail, document);
    assert.ok((await readFile(join(installed, document), 'utf8')).length > 100);
  }
  const version = JSON.parse(run(process.execPath, [join(installed, 'dist/cli.js'), '--version']));
  assert.equal(version.version, manifest.version);
  run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const library = await import('google-trends-for-agent');
    assert.equal(typeof library.TrendsClient, 'function');
    assert.equal(typeof library.apply, 'function');
    assert.equal(library.name, 'gtfa');
  `]);
  const audit = JSON.parse(run(npm, ['audit', '--omit=dev', '--audit-level=low', '--json']));
  assert.equal(audit.metadata.vulnerabilities.total, 0);
  console.log(JSON.stringify({ version: manifest.version, packedBytes: packed.size,
    installedExports: true, localizedDocuments: true, consumerVulnerabilities: 0 }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
