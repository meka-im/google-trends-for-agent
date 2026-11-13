import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VERSION } from '../src/version.js';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

afterEach(() => {
  vi.doUnmock('@deepseek-ai/schemastery');
  vi.resetModules();
});

describe('package root entry', () => {
  it('keeps the library API when schemastery is unresolvable', async () => {
    vi.resetModules();
    vi.doMock('@deepseek-ai/schemastery', () => { throw new Error('schemastery unavailable'); });
    const entry = await import('../src/index.js');
    expect(entry.TrendsClient).toBeTypeOf('function');
    expect(entry.queryTrends).toBeTypeOf('function');
    expect(entry.parseBaselines).toBeTypeOf('function');
    expect(entry.name).toBe('gtfa');
    expect(entry.inject).toEqual(['tools']);
    expect(entry.apply).toBeTypeOf('function');
    expect(entry.Config).toBeUndefined();
  });

  it('reads one version from package.json', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.version).toBe('0.2.1');
    expect(VERSION).toBe(pkg.version);
  });

  it('exports only the plugin root, client, locale, icon, and manifest', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(Object.keys(pkg.exports).sort()).toEqual([
      '.', './client', './icon', './locale/*.json', './package.json',
    ]);
    expect(pkg.exports['./client']).toBe('./dist/dsh-client.js');
    expect(pkg.icon).toBe('./icon.svg');
    expect(pkg.dsh.bundle.patch).toBe('./dsh/cordis.patch.yml');
  });

  it('mounts the bare package row and supplies row metadata', () => {
    expect(read('dsh/cordis.patch.yml')).toContain("name: 'google-trends-for-agent'");
    for (const locale of ['en', 'zh']) {
      const meta = JSON.parse(read(`locale/${locale}.json`)).meta;
      expect(meta.title).toBe('Google Trends');
      expect(meta.description).toBeTruthy();
    }
    expect(read('icon.svg')).toContain('<svg');
  });
});
