# Muse Setup Guide

[← All client guides](../clients.md)

**Recommended route:** Use Muse's **secure Bearer token form** (or authenticated Apify connector/API) against Apify's managed MCP gateway `https://mcp.apify.com?tools=meka.im/google-trends-for-agent` or Actor `meka.im/google-trends-for-agent`.

## Important: Known Muse OAuth DCR limitation

Apify's OAuth server uses **Dynamic Client Registration (RFC 7591 / DCR)** without a static pre-registered `client_id`. On `muse.ai`, the managed OAuth connection page can fail **before** redirecting to Apify with:

```text
Missing required parameters.
```

If you see that error on Muse's connection page, **do not loop or retry OAuth repeatedly**—and do not try to run `dsh`'s device-code OAuth script inside the agent shell (tokens must never pass through agent stdout or logs). Switch directly to the **Bearer token** path below.

## Setup with Bearer token (recommended on Muse)

1. Get your Personal API Token from [Apify Console → Settings → Integrations](https://console.apify.com/settings/integrations).
2. In Muse, open the **secure credential / connection form** (never paste the token into chat messages) and configure:
   - **Endpoint:** `https://mcp.apify.com?tools=meka.im/google-trends-for-agent` (or your own `<username>/<actor-name>`)
   - **Header:** `Authorization: Bearer <APIFY_TOKEN>`
3. Alternatively, if Muse already has an authenticated **Apify connector / REST API integration**, call Actor `meka.im/google-trends-for-agent` directly via Apify API and report that you used the connector.

## Calling the Actor and reading results

Pass `toolRequest` (protocol `1`) and read the full envelope from the run's key-value store record **`TOOL_RESPONSE`** (native `toolRequest` runs have 0 Dataset rows, which is normal):

- **`trends_snapshot`** (`term` string):
  ```json
  {
    "toolRequest": {
      "protocol": 1,
      "name": "trends_snapshot",
      "input": { "term": "Sora", "geo": "US", "time": "now 7-d", "fresh": true, "timeoutMs": 60000 }
    }
  }
  ```
- **`trends_compare`** (`keywords` array, **not** `terms`, with `calibrate: true` for MEKA multi-tier volume estimation):
  ```json
  {
    "toolRequest": {
      "protocol": 1,
      "name": "trends_compare",
      "input": { "keywords": ["ChatGPT", "Claude", "Gemini"], "geo": "US", "time": "now 7-d", "calibrate": true, "timeoutMs": 60000 }
    }
  }
  ```

For full field definitions, see [Client Setup Router](../clients.md) and [MCP field guide](../mcp-api.md).
