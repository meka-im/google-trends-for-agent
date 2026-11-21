# OpenClaw & Generic CLI / Local Agent Setup Guide

[← All client guides](../clients.md)

Use this guide for **OpenClaw**, custom agent frameworks, shell-driven bots, and any local Node.js >= 20 environment using `gtfa` (CLI) or `gtfa-mcp` (stdio / Streamable HTTP MCP).

## Quick start (zero-install via `npx`)

```sh
# Direct from this machine (default: US, now 7-d, MEKA v1 baselines):
npx -y -p github:meka-im/google-trends-for-agent gtfa snapshot Sora --geo US --json --pretty

# Compare 1–5 keywords with multi-tier MEKA search-volume estimation:
npx -y -p github:meka-im/google-trends-for-agent gtfa compare ChatGPT Claude Gemini --geo US --calibrate --json --pretty

# Route through Apify's public Actor residential proxy (recommended for cloud VMs):
APIFY_TOKEN=<your-token> npx -y -p github:meka-im/google-trends-for-agent gtfa snapshot Sora --geo US --egress actor-public --json --pretty
```

## Persistent install (recommended for frequent use or npm 10)

Building a GitHub dependency via `npx` was verified on npm 11.19.1; npm 10.9.4 can fail during packaging with a `GitFetcher` error. If you hit that error—or want instant startup without rebuilding—clone, pack, and install globally:

```sh
git clone https://github.com/meka-im/google-trends-for-agent.git
cd google-trends-for-agent
npm ci
npm install -g "$(npm pack | tail -1)"
```

## Local MCP server (stdio & Streamable HTTP)

**stdio MCP (generic `mcpServers` config):**

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "gtfa-mcp",
      "args": ["--egress", "actor-public"],
      "env": { "APIFY_TOKEN": "<your-apify-token>" }
    }
  }
}
```

Remove `"--egress", "actor-public"` and `"env"` to run directly from the host's network (`--egress local`).

**Local Streamable HTTP MCP (`127.0.0.1` only):**

```sh
gtfa-mcp --http --port 4321
# Endpoint: http://127.0.0.1:4321/mcp
```

## Useful CLI commands & environment variables

```sh
gtfa doctor --json                       # Diagnose Node, Google Trends reachability, proxy, live fetch
gtfa baselines --json                    # Inspect active MEKA v1 calibration baselines (59 anchors / 7 regions)
gtfa baselines --sync --json             # Manually sync the latest MEKA v1 baselines from meka.im
```

- `GTFA_EGRESS`: `local` (default) | `actor-public` | `actor-own`
- `GTFA_APIFY_ACTOR`: Actor ID when `GTFA_EGRESS=actor-own`
- `APIFY_TOKEN`: Apify token for `actor-public` / `actor-own`
- `HTTPS_PROXY` / `HTTP_PROXY`: Optional HTTP proxy for `local` egress (`http://host:port`)
- `GTFA_TZ`: Default IANA timezone for chart labels (default `UTC`)
- `GTFA_BASELINES`: Optional path to a version 2 custom baselines JSON file
