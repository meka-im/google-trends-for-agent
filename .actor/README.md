## What does Google Trends MCP for AI Agents do?

This Actor runs a **remote Model Context Protocol (MCP) server** over **Streamable HTTP** in Apify Standby mode. Point any MCP client that supports remote HTTPS servers at one URL, paste an Apify token, and the client can call Google Trends tools without a local Node.js install.

It returns **relative search interest** and **anchor-calibrated searches/day estimates** from the public [Google Trends](https://trends.google.com/) endpoints. It does not return private user data, and it is not affiliated with Google.

## Why use anchored traffic?

Google Trends reports a 0–100 relative scale, not search volume. The `trends_snapshot` tool compares a term with a window-aware anchor on the same scale, then applies a calibrated baseline to estimate **searches/day**: `sudoku` (US 63,000/day) for 1-hour/4-hour/1-day windows, `gpts` (US 3,500/day) for 7-day-and-longer windows. Numerical traffic stays `null` when the anchor is too sparse or when no calibration exists, instead of inventing a number.

This makes the output useful for comparing an emerging term with an established one, checking whether interest is rising, or adding a search-interest signal to an agent workflow. Light, interactive use only: this is an unofficial client for undocumented endpoints and has no SLA.

## Connect from an MCP client

1. Deploy this Actor and open it in Standby mode.
2. Use the standby URL for your Apify username:

```text
https://<user>--google-trends-for-agent.apify.actor/mcp
```

3. Add the header:

```text
Authorization: Bearer APIFY_TOKEN
```

Example client configuration:

```json
{
  "mcpServers": {
    "google-trends": {
      "url": "https://<user>--google-trends-for-agent.apify.actor/mcp",
      "headers": { "Authorization": "Bearer APIFY_TOKEN" }
    }
  }
}
```

The hostname uses your Apify username with dots replaced by hyphens (for example, `meka.im` becomes `meka-im`, so `https://meka-im--google-trends-for-agent.apify.actor/mcp`). The Actor console also shows the exact Standby URL.

## HTTP endpoints

`GET /` is the readiness endpoint (the `x-apify-container-server-readiness-probe` header still answers 200). MCP clients use `/mcp`; other callers can use the plain HTTP API with the same `Authorization: Bearer APIFY_TOKEN` header:

| Endpoint | Purpose |
| --- | --- |
| `POST /egress/fetch` | Relay one Google Trends request (`{ url, method?, headers, body?, timeoutMs }`); only `https://trends.google.com/...` is allowed. |
| `POST /tools/{name}` | Run `trends_ask`, `trends_snapshot`, `trends_compare`, or `trends_now`; returns `{ ok: true, result }` or `{ ok: false, error }`. |
| `GET /health` | Cheap health check: `{ ok: true, version }`; no Google call. |
| `GET /mcp` | Streamable HTTP MCP endpoint for MCP clients. |

The dsh plugin uses `/egress/fetch` for `apify` egress. Each request runs inside the Actor with its on-platform residential proxy. The Actor logs only the HTTP method and path, never query strings, headers, or bodies.

## Cost and idle exit

The Actor itself charges nothing. **Apify Residential proxy traffic is billed per GB from your Apify credits** at your plan's proxy rate; check the Apify Console for current pricing. Google Trends calls are small, but repeated `trends_now` calls over many countries use more proxy traffic than a single `trends_ask`.

A single-tenant Standby run bills compute while it is idle. This Actor exits cleanly after `GTFA_IDLE_EXIT_SECS` seconds with no in-flight requests (default 60), independent of the console idle timeout.

## Tools

| Tool | What it returns |
| --- | --- |
| `trends_ask` | Interest summary, Popular/Rising related queries, regions, optional verdict and diff. |
| `trends_compare` | Relative 0–100 interest for 2–5 keywords on one shared scale. |
| `trends_now` | Trending Now by country, with rank, growth, categories and links. |
| `trends_snapshot` | Calibrated searches/day, `anchor` / `anchor7d` and traffic blocks, verdict and chart paths. |

Defaults are US, past 24 hours, web search and all categories. Use `trends_now` for the separate Trending Now window. On `BLOCKED`, stop and report; on `RATE_LIMITED`, wait `retryAfterSec` and retry once at most.

## Input

- **Proxy configuration** — defaults to Apify Residential proxy, country US. Keep residential egress if Google rate-limits data-center IPs. The Actor rotates the proxy session when Google returns HTTP 429 or a challenge.
- **Calibration anchor** — leave empty for automatic: `sudoku` for 1-hour/4-hour/1-day windows, `gpts` for 7 days and longer. A term here forces both the requested and 7-day windows; a per-call `anchor` argument to `trends_snapshot` still wins. Self-hosted builds can set `GTFA_BASELINES` to a version 2 baselines file.
- **Default country** — default `US`; used when a tool call omits `geo`.

## Notes and support

- Unofficial and not endorsed by Google. Endpoints can change without notice.
- Use it for light, interactive research, not bulk scraping or continuous polling.
- If Google blocks the egress, rotate the proxy session or try again later; do not loop requests.
- Report Actor problems through the Issues tab of the source repository.
