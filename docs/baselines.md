# Regional calibration baselines

Calibration is an estimate of Google web searches across all categories. A baseline applies to its exact region, including the explicit empty geo `""` for Worldwide. It does not restrict which regions can be queried. Regions without a matching baseline still return relative interest and related queries; their numeric traffic fields stay `null`.

## Unified MEKA v1 baselines (API, CLI, MCP, Actor, and dsh)

All surfaces—Library API, CLI (`gtfa`), MCP (`gtfa-mcp`), Apify Actor, and the dsh plugin—share the same bundled **MEKA v1 baseline catalog** (59 Google Ads Keyword Planner anchors across 7 regions, revision `2026-11-19`, ±50% tolerance). It covers Worldwide (`""`), the US (`US`), Canada (`CA`), the UK (`GB`), Germany (`DE`), France (`FR`), and Japan (`JP`). Queries for other regions return relative interest by default with `null` traffic. [MEKA catalog and method](https://meka.im/datasets/google-trends-anchors)

Both `gtfa-mcp` and the dsh plugin automatically sync once from `https://meka.im/data/google-trends-anchors/baselines/v1/index.json` on initial install/first boot when `.meka-baselines.json` is absent, and reuse the cached disk snapshot on subsequent starts without further automatic network calls. Refresh manually at any time via `gtfa baselines --sync` or the dsh Settings page (`/api/gtfa.baselines-sync`).

| Region | Default anchor | Searches/day baseline | Tolerance | Tiers in catalog |
| --- | --- | ---: | --- | ---: |
| US (`US`) | `sudoku` | 88,000 | ±50% | 10 anchors |
| Canada (`CA`) | `sudoku` | 15,000 | ±50% | 7 anchors |
| United Kingdom (`GB`) | `crossword solver` | 27,000 | ±50% | 8 anchors |
| Germany (`DE`) | `Kreuzworträtsel` | 22,000 | ±50% | 8 anchors |
| France (`FR`) | `sudoku` | 22,000 | ±50% | 8 anchors |
| Japan (`JP`) | `テトリス` | 18,000 | ±50% | 8 anchors |
| Worldwide (`""`) | `stopwatch` | 160,000 | ±50% | 10 anchors |

### Multi-tier automatic calibration

- **`trends_snapshot` (MCP, CLI, Actor, dsh):** starts with the region's default anchor (`sudoku` in US/CA/FR, `crossword solver` in GB, `Kreuzworträtsel` in DE, `テトリス` in JP, `stopwatch` Worldwide). When no anchor is pinned and round 1 falls out of range, it automatically performs one second-round multi-tier MEKA comparison against closer regional anchors and upgrades `anchor` / `traffic` if rescued, returning full round details under `calibration`.
- **`trends_compare` (`calibrate: true` / `--calibrate`) and dsh dashboard:** selects regional anchors near 10,000 searches/day when comparison slots are available, or runs on-demand batch estimation (`batchVolume`) across multi-tier MEKA references. Anchors marked `30d+` (`dailyOnly`) qualify for 30-day, 90-day, and 12-month comparisons and follow-up estimates.
- **Overrides & reliability gate:** explicit query anchors, fixed plugin anchors, and version 2 `GTFA_BASELINES` overrides always take priority for matching region + term. These tolerance bands are broad assumptions about model and source uncertainty, **not statistical confidence intervals or accuracy guarantees**. The live reliability gate still applies: an anchor's non-gap mean must be at least 1, at least 25% of its non-gap points must be nonzero, and the term must have usable data; otherwise numeric traffic fields remain `null`.

## Historical pre-MEKA regional baseline review (2026-11-16)

Prior to unifying on the MEKA v1 59-anchor catalog, the package shipped a 10-entry regional table reviewed on **2026-11-16** (US `sudoku` 63,000 / `gpts` 3,500, plus single-anchor estimates for CA, GB, AU, DE, FR, JP, IN, and Worldwide). The dated evidence directory below is preserved as historical validation evidence.

### Reading search-volume estimates in dsh

A dashboard comparison starts one batch of up to five terms, including any
available reference slots. If an estimate is missing, **Estimate separately**
uses the saved region and time preset with a smaller group of regional anchors.
Each click starts one comparison through the current connection. Actor runs are
metered and their returned usage is included in the local cost card. History
shows the saved follow-up. A shifted rolling window appears with its own dates.

Dashboard estimates multiply a regional reference's historical daily baseline
by the target-to-reference mean interest ratio from matched, settled samples.
Sparse series and weak anchors leave the estimate blank. When usable anchors
give estimates more than 2× apart, the dashboard displays their spread. Short
intervals are expressed as daily equivalents. The year-long baseline is applied
to windows up to a year.

## Validation evidence

[The dated evidence directory](https://github.com/meka-im/google-trends-for-agent/tree/main/validation/2026-11-16-regional-baselines/) contains the API responses, source observations and Google Trends comparisons used for this review. Each new region was compared against ChatGPT in 24h and 7d windows, using one shared 0–100 scale per query. All sixteen final comparisons returned `ok`; their selected anchors passed the current reliability gate. There was no `BLOCKED` or `RATE_LIMITED` result. The benchmark demonstrates data access and numerical eligibility; it does not establish the accuracy of absolute search-volume estimates.

The evidence also retains rejected candidates. Canadian `gpts` had only 4 nonzero points out of 169 in the initial 7d probe. Indian 24h `sudoku` had only 3 nonzero points out of 180 against ChatGPT, so India's automatic anchor is `calculator`. Japanese validation used the literal `ナンプレ`, not an English spelling or a translated topic. Automated tests replay the saved comparisons through the snapshot conversion path without calling Google.

## Configuration and deployment

Version 2 baseline files keep the same shape: `anchors[{term, geo, dailySearches, tolerance?}]` and optional `windowAnchors.short` / `.long`. An explicit empty anchor `geo` now means Worldwide; an omitted geo in a file is invalid. The dsh schema continues to default an omitted geo to US and preserves an explicit empty value. User entries win over built-ins for the same normalized term and geo. A per-window override applies across query regions, so the selected term still needs a matching regional baseline.

The SDK exports `BASELINE_CATALOG`, including source URLs, measurement periods and source-check dates. The dsh page shows the complete built-in list by default, with a region filter for browsing. Browsing does not change query defaults or save any baseline. Custom overrides appear separately and retain existing edits; new custom rows start from the selected default region. Baselines and automatic selection come from the same shared catalog in CLI, MCP, the Actor and dsh.

For calibrated country requests, dsh includes the regional baseline and window choices in the bounded Actor request, so an existing Actor can use the supplied calibration. Worldwide calibrated requests require a current Actor build that accepts an empty anchor geo; rebuild an own Actor from `main` when updating the plugin. Relative-interest tools do not acquire a calibration requirement. Updating a package does not redeploy an own Actor or save a user's plugin configuration.

When reviewing a new source, preserve its actual measurement period, add a new dated evidence directory, verify both windows, and review source disagreement before changing a published estimate. Keep unsupported or unverifiable calibrations unavailable rather than filling them from another region.
