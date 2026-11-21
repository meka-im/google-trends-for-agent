# GrokBot Setup Guide

[← All client guides](../clients.md)

**Recommended route:** Apify's managed remote MCP gateway (`https://mcp.apify.com?tools=meka.im/google-trends-for-agent`) with native **Apify OAuth**. Verified working end-to-end on GrokBot.

## 1. Remove any legacy Standby connection first

If your GrokBot account has an older connection (often named `gtfa-apify`) pointing to `https://meka-im--google-trends-for-agent.apify.actor/mcp`, **delete it first**.

Standby mode is intentionally disabled so the Actor runs on demand (zero idle cost, works on Apify's Free plan). Calling the legacy `*.apify.actor` endpoint returns HTTP 400:

```json
{ "error": { "type": "actor-standby-mode-not-enabled", "message": "Actor Standby mode is not enabled for this Actor." } }
```

## 2. Register the managed remote MCP server

Add a native remote MCP connection in GrokBot using:

```json
{
  "mcpServers": {
    "google-trends-apify": {
      "url": "https://mcp.apify.com?tools=meka.im/google-trends-for-agent"
    }
  }
}
```

For your own Actor deployment, replace `meka.im/google-trends-for-agent` with `<username>/<actor-name>`.

Complete the **Apify OAuth** sign-in prompt in GrokBot (`full_api_access` scope). Verify that the Actor tool (for example `meka-dot-im--google-trends-for-agent`) appears in the active tool list.

## 3. Call the Actor cleanly (important field names)

The managed gateway exposes the Actor tool plus run/storage helpers—not four direct `trends_*` tool names. Pass `toolRequest` (protocol `1`) and read the full envelope from the run's key-value store record **`TOOL_RESPONSE`** (0 Dataset rows is normal for `toolRequest`):

- **`trends_snapshot`** uses **`term`** (string):
  ```json
  {
    "toolRequest": {
      "protocol": 1,
      "name": "trends_snapshot",
      "input": { "term": "Sora", "geo": "US", "time": "now 7-d", "fresh": true, "timeoutMs": 60000 }
    }
  }
  ```
- **`trends_compare`** uses **`keywords`** (string array, **not** `terms`) and optional **`calibrate: true`**:
  ```json
  {
    "toolRequest": {
      "protocol": 1,
      "name": "trends_compare",
      "input": { "keywords": ["ChatGPT", "Claude", "Gemini"], "geo": "US", "time": "now 7-d", "calibrate": true, "timeoutMs": 60000 }
    }
  }
  ```

## Fallback

If remote MCP registration is temporarily unavailable, GrokBot's authenticated Apify connector/API can invoke the exact same Actor `meka.im/google-trends-for-agent` with the same `toolRequest` payload; report that you used the connector rather than native MCP.
