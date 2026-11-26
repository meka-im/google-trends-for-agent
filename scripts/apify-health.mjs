import { pathToFileURL } from 'node:url';

const DEFAULT_API_BASE = 'https://api.apify.com/v2';
const DEFAULT_ACTOR_ID = 'QUx4aBkz4QCSchDV4';
const PROBE_INPUT = {
  tool: 'snapshot',
  terms: ['Sora'],
  geo: 'US',
  window: 'now 7-d',
  anchor: '',
};

async function readJsonResponse(response, label) {
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 300) };
    }
  }
  if (!response.ok) {
    const error = new Error(`${label} failed with HTTP ${response.status}`);
    error.status = response.status;
    error.body = parsed;
    throw error;
  }
  return parsed;
}

/**
 * Inspect the public/authenticated Apify Actor status, run a live prefill probe
 * when needed, clear `UNDER_MAINTENANCE`, and optionally trigger a fresh build
 * to reset Apify Store's 3-day automated test counter.
 */
export async function checkAndRecoverApifyActor(options = {}) {
  const actorId = options.actorId ?? (process.env.APIFY_ACTOR_ID || DEFAULT_ACTOR_ID);
  const token = (options.token ?? process.env.APIFY_TOKEN ?? '').trim();
  const forceProbe = options.forceProbe ?? (process.env.FORCE_PROBE === 'true');
  const rebuildOnRecover = options.rebuildOnRecover ?? (process.env.REBUILD_ON_RECOVER !== 'false');
  const apiBase = (options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const requestJson = async (path, init = {}) => {
    const headers = {
      accept: 'application/json',
      ...(init.body !== undefined ? { 'content-type': 'application/json; charset=utf-8' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    };
    const response = await fetchImpl(`${apiBase}${path}`, {
      ...init,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    return readJsonResponse(response, `${init.method ?? 'GET'} ${path}`);
  };

  const initialPayload = await requestJson(`/actors/${encodeURIComponent(actorId)}`);
  const initial = initialPayload?.data ?? initialPayload ?? {};
  const notice = initial.notice ?? null;
  const isDeprecated = Boolean(initial.isDeprecated);
  const latestBuild = initial.taggedBuilds?.latest?.buildNumber ?? null;

  if (notice !== 'UNDER_MAINTENANCE' && !isDeprecated && !forceProbe) {
    return { ok: true, status: 'healthy', notice, isDeprecated, latestBuild, recovered: false };
  }

  if (!token) {
    if (notice === 'UNDER_MAINTENANCE' || isDeprecated) {
      return {
        ok: false,
        status: 'needs-token',
        notice,
        isDeprecated,
        latestBuild,
        recovered: false,
        message: `Actor requires attention (notice=${notice}, isDeprecated=${isDeprecated}), but APIFY_TOKEN secret is not set.`,
      };
    }
    return { ok: true, status: 'healthy-no-token', notice, isDeprecated, latestBuild, recovered: false };
  }

  const runPayload = await requestJson(`/acts/${encodeURIComponent(actorId)}/runs?waitForFinish=120&build=latest`, {
    method: 'POST',
    body: PROBE_INPUT,
  });
  const run = runPayload?.data ?? runPayload ?? {};
  const runId = run.id ?? null;
  const runStatus = run.status ?? null;
  const datasetId = run.defaultDatasetId ?? null;
  if (runStatus !== 'SUCCEEDED' || !datasetId) {
    return {
      ok: false,
      status: 'probe-failed',
      notice,
      runId,
      runStatus,
      recovered: false,
      message: `Live probe run did not succeed (status=${runStatus ?? 'unknown'}).`,
    };
  }

  const itemsPayload = await requestJson(`/datasets/${encodeURIComponent(datasetId)}/items?limit=5`);
  const items = Array.isArray(itemsPayload) ? itemsPayload : Array.isArray(itemsPayload?.items) ? itemsPayload.items : [];
  const hasOkRow = items.some(item => item && item.status === 'ok');
  if (!hasOkRow) {
    return {
      ok: false,
      status: 'probe-failed',
      notice,
      runId,
      runStatus,
      recovered: false,
      message: 'Live probe run succeeded but produced no usable status=ok row.',
    };
  }

  if (notice === 'UNDER_MAINTENANCE') {
    await requestJson(`/actors/${encodeURIComponent(actorId)}`, {
      method: 'PUT',
      body: { notice: 'NONE' },
    });
    let rebuildStatus = null;
    if (rebuildOnRecover) {
      const buildPayload = await requestJson(`/acts/${encodeURIComponent(actorId)}/builds?version=0.3&tag=latest&waitForFinish=180`, {
        method: 'POST',
      });
      rebuildStatus = (buildPayload?.data ?? buildPayload)?.status ?? null;
    }
    const afterPayload = await requestJson(`/actors/${encodeURIComponent(actorId)}`);
    const after = afterPayload?.data ?? afterPayload ?? {};
    const afterNotice = after.notice ?? null;
    return {
      ok: afterNotice === 'NONE',
      status: afterNotice === 'NONE' ? 'recovered' : 'clear-failed',
      notice: afterNotice,
      runId,
      rebuildStatus,
      recovered: afterNotice === 'NONE',
    };
  }

  return { ok: true, status: 'probe-ok', notice, runId, recovered: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkAndRecoverApifyActor()
    .then(result => {
      console.log(JSON.stringify(result));
      if (!result.ok) process.exitCode = 1;
    })
    .catch(error => {
      console.error(JSON.stringify({ ok: false, status: 'error', message: error instanceof Error ? error.message : String(error) }));
      process.exitCode = 1;
    });
}
