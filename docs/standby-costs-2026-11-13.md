# Historical Standby cost measurements — 2026-11-13

The Standby mode below was retired in 0.2.7 after long-lived MCP connections were observed to prevent idle shutdown. These old measurements are not current on-demand prices.

Both Actor routes run in the caller's Apify account with the same image and Standby settings (single-tenant, 512 MB, 60 s idle), so a call costs the same on the public Actor and on a self-deployed copy. There is no Actor fee. Self-deploy adds a build each time you update (measured $0.0048–0.0058 per build).

```text
cost ≈ (runSecs × 0.5 GB ÷ 3600) × $0.2/CU + residentialGB × $8/GB
runSecs ≈ request time + ~60 s idle tail (an isolated call measured 67–68 s)
```

Measured on 2026-11-13 against the public Standby URL (US, `now 1-d`, sequential calls; Free-plan rates). Costs are Apify's final per-run `usageTotalUsd`; storage and data-transfer items add under $0.0001 per Standby run.

| Case | Run time | CU | Residential | Cost | Free $5 covers |
| --- | --- | --- | --- | --- | --- |
| Isolated `trends_ask` (startup, 10.8 s response) | 67 s | 0.0094 | 61 KB | $0.0024 | ≈ 2,100 calls |
| Isolated `trends_snapshot` (startup, 31 s response) | 68 s | 0.0094 | 122 KB | $0.0029 | ≈ 1,700 calls |
| 10 × `trends_ask` in one session (8.0–24.9 s each, median 8.3 s) | 160 s | 0.0222 | 592 KB | $0.0092 | ≈ 540 sessions (5,400 calls) |
| Each extra warm `trends_ask` | — | — | ~59 KB | ≈ $0.0008 | — |

The warm figure is (session − isolated ask) ÷ 9. Startup overhead (+~3 s) is the first call's response time after idle minus the warm median; a cold Actor can occasionally take up to ~2 minutes. Warm asks take ~8 s because MCP requests are spaced 1500 ms apart. Most of an isolated call's cost is the 60 s idle tail, so batching calls into one session is the cheapest pattern. One-off runs bill the same way without the idle tail (one measured run: two snapshots in 32 s, $0.0031). Isolated `trends_ask` ≈ $0.0024 (measured 2026-11-13, Apify Free-plan rates); snapshots ≈ $0.0029; extra warm calls ≈ $0.0008. The plugin uses the same figures.

