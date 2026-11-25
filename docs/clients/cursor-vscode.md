# Cursor, VS Code, Windsurf & Cline Setup Guide

[← All client guides](../clients.md)

IDE agents (Cursor, VS Code Copilot MCP, Windsurf, Cline) can connect either via **Streamable HTTP** to Apify's hosted MCP gateway or via **local stdio** (`gtfa-mcp`).

## Option 1: Hosted Apify Streamable HTTP MCP

Add to `.cursor/mcp.json`, `.vscode/mcp.json`, or your IDE's MCP settings:

```json
{
  "mcpServers": {
    "google-trends-apify": {
      "url": "https://mcp.apify.com?tools=meka.im/google-trends-for-agent"
    }
  }
}
```

Complete the **Apify OAuth** sign-in prompt when the IDE asks to authenticate.

### Troubleshooting IDE OAuth loops

Some Cursor / VS Code versions loop on OAuth ("Needs authentication" / "Saving PKCE code verifier"). If OAuth loops, switch to a **Bearer token header** using your Personal API Token from [Apify Console → Settings → Integrations](https://console.apify.com/settings/integrations):

```json
{
  "mcpServers": {
    "google-trends-apify": {
      "type": "http",
      "url": "https://mcp.apify.com?tools=meka.im/google-trends-for-agent",
      "headers": {
        "Authorization": "Bearer <your-apify-token>"
      }
    }
  }
}
```

> Do not commit tokens into shared workspace files; keep Bearer headers in user-level MCP settings or use IDE secret inputs.

Call the Actor with `toolRequest` (`trends_snapshot` uses `term`; `trends_compare` uses `keywords` + `calibrate: true`) and read `TOOL_RESPONSE` from the run's key-value store. See [shared `toolRequest` examples](../clients.md#calling-the-actor-via-remote-mcp-or-connector-shared-schema).

## Option 2: Local stdio MCP (4 direct `trends_*` tools)

Requires **Node.js >= 20**. Gives direct access to `trends_ask`, `trends_snapshot`, `trends_compare`, and `trends_now` (with optional `--egress actor-public` + `APIFY_TOKEN` for Apify residential proxy):

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["-y", "-p", "github:meka-im/google-trends-for-agent", "gtfa-mcp", "--egress", "actor-public"],
      "env": {
        "APIFY_TOKEN": "<your-apify-token>"
      }
    }
  }
}
```

Omit `"--egress", "actor-public"` and `"env"` to run directly from your local machine IP.
