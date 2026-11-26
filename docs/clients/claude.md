# Claude Code & Claude Desktop Setup Guide

[← All client guides](../clients.md)

Claude supports both **Apify's hosted remote HTTP MCP** (zero local install, residential proxy) and **local stdio MCP** (exposes all four direct `trends_*` tool names).

## Option 1: Claude Code — Remote Apify MCP (recommended)

```sh
claude mcp add --transport http google-trends-apify "https://mcp.apify.com?tools=meka.im/google-trends-for-agent"
```

Then run `/mcp` inside Claude Code and complete **Apify OAuth** sign-in (`full_api_access` scope).

> Use Streamable HTTP (`https://mcp.apify.com?...`); do not use deprecated `/sse` endpoints or legacy `*.apify.actor` Standby URLs.

To call the Actor cleanly through the managed gateway, pass `toolRequest` (`trends_snapshot` uses `term`; `trends_compare` uses `keywords` + `calibrate: true`) and read `TOOL_RESPONSE` from the run's key-value store. See [shared `toolRequest` examples](../clients.md#calling-the-actor-via-remote-mcp-or-connector-shared-schema).

## Option 2: Claude Desktop or Claude Code — Local stdio MCP (4 direct `trends_*` tools)

Requires **Node.js >= 20**. Add to Claude Desktop's `claude_desktop_config.json` (or Claude Code's `.mcp.json`):

**With Apify cloud residential proxy (recommended if local IP gets rate-limited):**

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["-y", "-p", "google-trends-for-agent", "gtfa-mcp", "--egress", "actor-public"],
      "env": {
        "APIFY_TOKEN": "<your-apify-token>"
      }
    }
  }
}
```

**Direct from your own machine (no Apify token required):**

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["-y", "-p", "google-trends-for-agent", "gtfa-mcp"]
    }
  }
}
```

Restart Claude Desktop after saving. This exposes `trends_ask`, `trends_snapshot`, `trends_compare` (with `calibrate: true`), and `trends_now` directly, defaulting to `US` / `now 7-d` with MEKA v1 baselines.

> For instant startup without `npx`, install globally (`npm install -g google-trends-for-agent`) as shown in the [OpenClaw & CLI guide](openclaw.md#persistent-install-recommended-for-frequent-use) and set `"command": "gtfa-mcp"`.
