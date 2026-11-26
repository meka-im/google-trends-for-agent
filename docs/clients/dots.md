# Dots & Hosted Web Agents Setup Guide

[← All client guides](../clients.md)

**Important for agents running inside Dots / hosted web chats:** Check your host capabilities **first** before calling `https://mcp.apify.com`. Sending an unauthenticated HTTP request directly from the chat will always return HTTP `401 invalid_token`—an in-chat turn cannot launch a browser OAuth popup by itself.

Choose the path that matches your actual host environment:

## Path A: Host has a Settings / Connectors / MCP UI (recommended)

1. Ask the user to open the client's **Settings → MCP / Connectors** (and remove any legacy `*.apify.actor` Standby URL first).
2. Add a remote MCP server:
   - **URL:** `https://mcp.apify.com?tools=meka.im/google-trends-for-agent` (or `<username>/<actor-name>` for a self-deployment)
   - **Auth:** Choose **OAuth** and complete Apify sign-in (`full_api_access` scope). If the UI does not support OAuth, add the header `Authorization: Bearer <APIFY_TOKEN>` in the client's secure credential UI (never in chat).
3. Open a fresh session and verify that the Apify Actor tool appears in the active tool list.
4. Call the Actor using `toolRequest` (`trends_snapshot` uses `term`; `trends_compare` uses `keywords` + `calibrate: true`) and read `TOOL_RESPONSE` from the run's key-value store. See [shared `toolRequest` examples](../clients.md#calling-the-actor-via-remote-mcp-or-connector-shared-schema).

## Path B: Client supports Codex CLI / stdio MCP config

If your Dots environment exposes local MCP configuration or Codex CLI, follow the [Codex guide](codex.md) or configure local stdio with Apify cloud egress:

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["-y", "-p", "google-trends-for-agent", "gtfa-mcp", "--egress", "actor-public"],
      "env": { "APIFY_TOKEN": "<your-apify-token>" }
    }
  }
}
```

This exposes all four direct `trends_*` tool names while still routing Google Trends traffic through Apify's residential proxy.

## Path C: Shell / Node sandbox without remote MCP UI

If the host has **no** remote MCP UI and **no** OAuth capability, do not loop on `401` against `mcp.apify.com`:

- **If `APIFY_TOKEN` is available in the sandbox's secret environment:** run the CLI with cloud egress:
  ```sh
  npx -y -p google-trends-for-agent gtfa snapshot Sora --geo US --egress actor-public --json --pretty
  npx -y -p google-trends-for-agent gtfa compare ChatGPT Claude Gemini --geo US --calibrate --egress actor-public --json --pretty
  ```
- **If no `APIFY_TOKEN` is configured:** inform the user that remote OAuth cannot be initiated inside this chat turn and ask them to either connect `https://mcp.apify.com?tools=meka.im/google-trends-for-agent` in host settings or explicitly authorize a direct local test (`--egress local`, noting cloud VM IPs may hit Google Trends `RATE_LIMITED` / `BLOCKED`).
