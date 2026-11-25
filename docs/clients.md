# Client Setup Router

**Agents: identify which host/client you are running in, then follow ONLY your matching guide below before configuring or calling tools.**

| Client / Bot | Recommended route | Auth method | Dedicated guide |
| --- | --- | --- | --- |
| **DeepSeek Harness (dsh)** | Native in-process plugin (Local / Public Actor / Own Actor) | Built-in Apify device OAuth (or manual token) | [dsh setup guide](clients/dsh.md) |
| **GrokBot** | Apify managed remote MCP (`https://mcp.apify.com?tools=meka.im/google-trends-for-agent`) | Native MCP OAuth (remove any legacy `*.apify.actor` Standby connection first) | [GrokBot setup guide](clients/grokbot.md) |
| **Muse** | Apify connector/API or managed remote MCP | **Secure credential form (Bearer `APIFY_TOKEN`)** — bypasses Muse's DCR OAuth bug | [Muse setup guide](clients/muse.md) |
| **Dots & Web Agents** | Host MCP Settings UI (`mcp.apify.com`) or sandbox CLI `--egress actor-public` | Host Settings OAuth/Bearer, or `APIFY_TOKEN` env secret | [Dots setup guide](clients/dots.md) |
| **Claude Code & Claude Desktop** | Remote HTTP MCP (`mcp.apify.com`) or local stdio `gtfa-mcp` | `/mcp` OAuth or `APIFY_TOKEN` in stdio `env` | [Claude setup guide](clients/claude.md) |
| **OpenAI Codex CLI & App** | Remote MCP (`codex mcp add`) or local stdio `gtfa-mcp` | `codex mcp login` OAuth or `APIFY_TOKEN` in stdio `env` | [Codex setup guide](clients/codex.md) |
| **Cursor, VS Code, Windsurf & Cline** | Streamable HTTP `mcp.json` or local stdio `gtfa-mcp` | OAuth (or Bearer header if IDE loops on OAuth) | [Cursor & VS Code setup guide](clients/cursor-vscode.md) |
| **OpenClaw & Generic CLI / Local Agents** | Local CLI (`gtfa`) or stdio / HTTP MCP (`gtfa-mcp`) | Direct (`--egress local`) or `--egress actor-public` + `APIFY_TOKEN` | [OpenClaw & CLI guide](clients/openclaw.md) |

---

## Choose an Apify Actor (shared by all cloud routes)

| Deployment | Actor | Managed MCP URL |
| --- | --- | --- |
| Public, no deployment needed | `meka.im/google-trends-for-agent` | `https://mcp.apify.com?tools=meka.im/google-trends-for-agent` |
| Your own, after a successful build | `<username>/<actor-name>` | `https://mcp.apify.com?tools=<username>/<actor-name>` |

- Keep **Server / Standby disabled**. Never connect to legacy `https://<user>--google-trends-for-agent.apify.actor/mcp` URLs (they return HTTP 400 `actor-standby-mode-not-enabled`).
- Both public and own Actors run **on demand** and exit immediately after returning results; compute, residential proxy, and storage usage are billed to the caller's Apify account (works on Apify's Free plan $5 monthly credits). See [deployment](../README.md#deploy-it-yourself) and [Actor costs](reference.md#actor-costs).
- Apify's OAuth scope is account-wide `full_api_access` (the account owner approves it). Never paste an `APIFY_TOKEN` into chat messages, prompts, URLs, or Actor inputs—always use OAuth or the client's secure credential/env store.

---

## Calling the Actor via remote MCP or connector (shared schema)

Apify's managed gateway exposes an Actor tool (e.g. `meka-dot-im--google-trends-for-agent`) plus run, Dataset, key-value-store, and abort helpers—**not** the four direct `trends_*` tool names (those are provided by local `gtfa-mcp` and the dsh plugin).

### Option 1: Ordinary Actor input (writes Dataset + `OUTPUT`)

```json
{
  "tool": "snapshot",
  "terms": ["Sora"],
  "geo": "US",
  "window": "now 7-d",
  "timeoutMs": 60000
}
```

### Option 2: Native `toolRequest` (full 4-tool envelopes in KV store `TOOL_RESPONSE`)

Read `TOOL_RESPONSE` from the run's default key-value store (`result` is the full envelope; `runtime` reports `version` and `baselineCatalogRevision`). Native `toolRequest` runs legitimately have 0 Dataset rows—do not treat 0 Dataset rows as failure.

**Single-term snapshot (`trends_snapshot`, note field `term`):**

```json
{
  "toolRequest": {
    "protocol": 1,
    "name": "trends_snapshot",
    "input": {
      "term": "Sora",
      "geo": "US",
      "time": "now 7-d",
      "fresh": true,
      "timeoutMs": 60000
    }
  }
}
```

**Multi-term comparison with search-volume calibration (`trends_compare`, note field `keywords`, NOT `terms`):**

```json
{
  "toolRequest": {
    "protocol": 1,
    "name": "trends_compare",
    "input": {
      "keywords": ["ChatGPT", "Claude", "Gemini"],
      "geo": "US",
      "time": "now 7-d",
      "calibrate": true,
      "timeoutMs": 60000
    }
  }
}
```

Full field reference for all four tools (`trends_ask`, `trends_snapshot`, `trends_compare`, `trends_now`): [MCP field guide](mcp-api.md) and [Reference](reference.md).

## Acceptance & error rules (all clients)

- Start one run and inspect it; do not start duplicate runs while one is active.
- A `SUCCEEDED` run alone does not prove data arrived: inspect `result.status`, `result.error`, `runtime.version`, `runtime.baselineCatalogRevision`, and `meta.fetchedAt`.
- Report `null` calibration values honestly; never substitute internal hints (such as `anchorTargetDaily`) as final volume estimates.
- On `BLOCKED` or `RATE_LIMITED`, stop that validation path and report the error plus `retryAfterSec` when present.
