import { parseArgs } from 'node:util';
import { createMekaBaselinesSync } from './dsh-baselines-sync.js';

export const baselinesHelp = `Usage: gtfa baselines [options]
  Inspect or manually sync the MEKA Google Ads Keyword Planner calibration baselines.
  --sync              Fetch the latest MEKA v1 baselines from meka.im and cache locally
  --store DIR         Snapshot storage directory (default .gtfa/snapshots)
  --json              Output JSON
  --pretty            Indent JSON output
  --help`;

export async function runBaselinesCli(args: string[], options: { fetch?: typeof globalThis.fetch } = {}) {
  let pretty = args.includes('--pretty');
  try {
    const { values: v } = parseArgs({
      args,
      options: {
        sync: { type: 'boolean' },
        store: { type: 'string' },
        json: { type: 'boolean' },
        pretty: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    });
    pretty = v.pretty ?? false;
    const formatJson = (value: unknown) => JSON.stringify(value, null, pretty ? 2 : undefined);
    if (v.help) {
      return { code: 0, stdout: process.stdout.isTTY && !v.json ? baselinesHelp : formatJson({ help: baselinesHelp }), stderr: '' };
    }
    const snapshotDir = v.store?.trim() || process.env.GTFA_SNAPSHOT_DIR?.trim() || '.gtfa/snapshots';
    const boundary = createMekaBaselinesSync({
      getSnapshotDir: () => snapshotDir,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    if (v.sync) {
      const result = await boundary.sync();
      if (v.json) return { code: result.ok ? 0 : 1, stdout: formatJson(result), stderr: result.ok ? '' : (result.message ?? 'Sync failed') };
      if (!result.ok) return { code: 1, stdout: '', stderr: result.message ?? 'Failed to sync MEKA baselines.' };
      const note = result.updated ? 'Updated' : 'Already up to date';
      return {
        code: 0,
        stdout: `${note}: MEKA baselines ${result.status.version} (${result.status.count} anchors across ${result.status.regions.length} regions).`,
        stderr: '',
      };
    }
    const status = await boundary.status();
    if (v.json) return { code: 0, stdout: formatJson(status), stderr: '' };
    const lines = [
      `MEKA baselines: ${status.version} (${status.source})`,
      `Anchors: ${status.count} across ${status.regions.length} regions (${status.regions.map(r => r || 'Worldwide').join(', ')})`,
      ...(status.syncedAt ? [`Synced at: ${status.syncedAt}`] : ['Synced at: not synced yet (run "gtfa baselines --sync")']),
    ];
    return { code: 0, stdout: lines.join('\n'), stderr: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid baselines command';
    return { code: 4, stdout: '', stderr: message };
  }
}
