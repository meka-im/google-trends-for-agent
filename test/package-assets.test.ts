import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temporaryRoots: string[] = [];

interface PackResult {
  files: { path: string }[];
}

afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('published package assets', () => {
  it('includes the Actor README needed by relative links from published docs', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'gtfa-pack-'));
    temporaryRoots.push(temporary);
    const links = [
      { source: 'README.md', target: '.actor/README.md' },
      { source: 'README.zh-CN.md', target: '.actor/README.md' },
      { source: 'docs/reference.md', target: '../.actor/README.md' },
    ];
    const packagePath = join(root, 'package.json');
    const temporaryPackage = JSON.parse(readFileSync(packagePath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    delete temporaryPackage.scripts?.prepare;
    writeFileSync(join(temporary, 'package.json'), JSON.stringify(temporaryPackage, null, 2));
    for (const path of ['README.md', 'README.zh-CN.md', 'docs/reference.md', '.actor/README.md', 'LICENSE']) {
      const destination = join(temporary, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(root, path), destination);
    }
    const output = execFileSync(npm, [
      'pack', '--dry-run', '--json', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error',
    ], { cwd: temporary, encoding: 'utf8' });
    const packed = new Set((JSON.parse(output) as PackResult[])[0]!.files.map(file => file.path));

    for (const link of links) {
      const resolved = posix.normalize(posix.join(posix.dirname(link.source), link.target));
      expect(readFileSync(new URL(`../${link.source}`, import.meta.url), 'utf8')).toContain(`](${link.target})`);
      expect(packed.has(resolved), `${link.source} links to unpacked ${resolved}`).toBe(true);
    }
  });
});
