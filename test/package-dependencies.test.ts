import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const requireFromRoot = createRequire(join(root, 'package.json'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tar = process.platform === 'win32' ? 'tar.exe' : 'tar';

interface PackResult {
  filename: string;
  files: { path: string }[];
}

interface PackageManifest {
  bundleDependencies?: string[];
  name: string;
  version: string;
}

interface PackageLock {
  packages: Record<string, { version?: string }>;
}

describe('published package dependencies', () => {
  let temporaryRoot: string;
  let tarball: string;
  let packedPaths: Set<string>;

  beforeAll(() => {
    temporaryRoot = mkdtempSync(join(tmpdir(), 'gtfa-dependencies-'));
    const output = execFileSync(npm, [
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      temporaryRoot,
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
    ], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const packed = (JSON.parse(output) as PackResult[])[0]!;
    tarball = join(temporaryRoot, packed.filename);
    packedPaths = new Set(packed.files.map(file => file.path));
  }, 30_000);

  afterAll(() => {
    rmSync(temporaryRoot, { recursive: true, force: true });
  });

  function packedManifest(path: string): PackageManifest {
    return JSON.parse(execFileSync(tar, [
      '-xOzf',
      tarball,
      `package/${path}/package.json`,
    ], { encoding: 'utf8' })) as PackageManifest;
  }

  function installedPath(name: string): string {
    const manifestPath = requireFromRoot.resolve(`${name}/package.json`);
    return relative(root, manifestPath).split(sep).join('/').replace(/\/package\.json$/, '');
  }

  function tarballContains(packageName: string): boolean {
    const suffix = `/${packageName}/package.json`;
    return [...packedPaths].some(path => path === suffix.slice(1) || path.endsWith(suffix));
  }

  it('bundles the locked safe apify runtime tree without basic-ftp', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageManifest;
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as PackageLock;

    expect(manifest.bundleDependencies).toEqual(['apify']);

    for (const name of ['apify', 'apify-client', '@crawlee/core', 'minimatch']) {
      const path = installedPath(name);
      const installed = JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8')) as PackageManifest;
      const bundled = packedManifest(path);

      expect(bundled.name).toBe(name);
      expect(bundled.version).toBe(installed.version);
      expect(bundled.version).toBe(lock.packages[path]?.version);
      expect(packedPaths.has(`${path}/package.json`), `${path} is missing from the tarball`).toBe(true);
    }

    const minimatch = packedManifest(installedPath('minimatch'));
    expect(Number(minimatch.version.split('.')[0])).toBeGreaterThanOrEqual(11);
    const crawleeRequire = createRequire(requireFromRoot.resolve('@crawlee/core/package.json'));
    const crawleeMinimatch = crawleeRequire('minimatch') as {
      Minimatch: new (pattern: string, options?: { nocase?: boolean }) => { match: (path: string) => boolean };
      minimatch: (path: string, pattern: string, options?: { nocase?: boolean }) => boolean;
    };
    const resolvedMinimatch = relative(root, crawleeRequire.resolve('minimatch/package.json'))
      .split(sep)
      .join('/');
    expect(resolvedMinimatch).toBe(`${installedPath('minimatch')}/package.json`);
    expect(new crawleeMinimatch.Minimatch('https://example.com/**', { nocase: true })
      .match('HTTPS://EXAMPLE.COM/path')).toBe(true);
    expect(crawleeMinimatch.minimatch('https://example.com/path', '**/path', { nocase: true })).toBe(true);
    expect(tarballContains('basic-ftp')).toBe(false);
    expect(tarballContains('vitest')).toBe(false);
    expect(tarballContains('typescript')).toBe(false);
  });
});
