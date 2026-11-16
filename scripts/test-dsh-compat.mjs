import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok(major > 24 || (major === 24 && minor >= 9), 'The dsh integration check requires Node >=24.9');
const baselines = JSON.parse(await readFile(join(root, 'test/compat/baselines.json'), 'utf8'));
const requested = process.argv.slice(2);
const versions = requested.length ? requested : baselines;
for (const version of versions) assert.ok(baselines.includes(version), `Unstaged dsh version: ${version}`);
const temporary = await mkdtemp(join(tmpdir(), 'gtfa-dsh-compat-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  const npmConfig = join(temporary, 'empty.npmrc');
  await writeFile(npmConfig, '');
  const [packed] = JSON.parse(execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], {
    cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
  }));
  for (const version of versions) {
    const stage = join(temporary, version);
    const home = join(stage, 'home');
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeFile(join(stage, 'package.json'), JSON.stringify({ name: 'gtfa-host-check', private: true, type: 'module' }));
    // Only process-launch essentials cross into the test installation. Never inherit account credentials or .env files.
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'CI',
      'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    Object.assign(env, { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
      npm_config_userconfig: npmConfig, npm_config_cache: join(temporary, 'npm-cache') });
    execFileSync(npm, ['install', '--ignore-scripts', '--include=optional', '--no-audit', '--no-fund',
      `@deepseek-ai/dsh@${version}`, join(temporary, packed.filename)], {
      cwd: stage, env, stdio: 'inherit', timeout: 240_000,
    });
    const output = execFileSync(process.execPath, [join(root, 'test/compat/host.mjs'), stage], {
      cwd: stage, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
    });
    const result = output.split('\n').find(line => line.startsWith('GTFA_COMPAT_RESULT '));
    assert.ok(result, `dsh ${version} produced no success report`);
    const report = JSON.parse(result.slice('GTFA_COMPAT_RESULT '.length));
    assert.equal(report.dsh, version);
    console.log(result);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
