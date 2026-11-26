# OpenAI Codex CLI & App Setup Guide

[← All client guides](../clients.md)

Codex supports both **Apify's hosted remote MCP with OAuth** and **local stdio `gtfa-mcp`**.

## Option 1: Remote Apify MCP via Codex CLI (recommended)

Register and authenticate the managed Apify MCP gateway:

```sh
codex mcp add google-trends-apify --url 'https://mcp.apify.com?tools=meka.im/google-trends-for-agent'
codex mcp login google-trends-apify
```

For your own Actor deployment, replace `meka.im/google-trends-for-agent` with `<username>/<actor-name>`.

Open a fresh Codex session and verify the Actor tool appears in your tool list. Call it using `toolRequest` (`trends_snapshot` uses `term`; `trends_compare` uses `keywords` + `calibrate: true`) and read `TOOL_RESPONSE` from the run's key-value store. See [shared `toolRequest` examples](../clients.md#calling-the-actor-via-remote-mcp-or-connector-shared-schema).

## Option 2: Local stdio MCP (4 direct `trends_*` tools)

Requires **Node.js >= 20**. Add a local stdio server with optional Apify cloud egress:

```sh
# Direct from this machine:
codex mcp add google-trends -- npx -y -p google-trends-for-agent gtfa-mcp

# Or route through Apify's public Actor residential proxy (set APIFY_TOKEN in env):
codex mcp add google-trends --env APIFY_TOKEN -- npx -y -p google-trends-for-agent gtfa-mcp --egress actor-public
```

Local stdio exposes `trends_ask`, `trends_snapshot`, `trends_compare` (with `calibrate: true`), and `trends_now` directly, defaulting to `US` / `now 7-d` with MEKA v1 baselines.

> For instant startup without `npx`, install globally (`npm install -g google-trends-for-agent`) as shown in the [OpenClaw & CLI guide](openclaw.md#persistent-install-recommended-for-frequent-use) and register `gtfa-mcp` directly.
