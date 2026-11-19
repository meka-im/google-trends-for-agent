# Regional calibration baselines

Calibration is an estimate of Google web searches across all categories. A baseline applies to its exact region, including the explicit empty geo `""` for Worldwide. It does not restrict which regions can be queried. Regions without a matching baseline still return relative interest and related queries; their numeric traffic fields stay `null`.

## MEKA baselines in dsh

dsh includes the MEKA baseline catalog dated 2026-11-19, with 70 Google Ads Keyword Planner anchors for Worldwide and eight countries. Single-term calibration starts from the middle of the selected region's volume tiers. The dashboard uses spare comparison slots for anchors and calibrates each term against its closest usable anchor in the same request. Five entered terms can be calibrated when they include a known anchor. [MEKA catalog and method](https://meka.im/datasets/google-trends-anchors)

Fixed anchors, window choices, and custom baselines take priority. The catalog snapshot ships with the plugin. A new snapshot takes effect with a plugin update. The plugin uses the existing query limits and displays a missing estimate when the comparison supplies too little signal.

## Built-in defaults for CLI, MCP and Actor

Sources reviewed on **2026-11-16**. Review dates are separate from the providers' measurement periods below. The US calibration is retained; the other entries are rounded regional estimates.

| Region | Automatic anchor | Searches/day baseline | Assumption band |
| --- | --- | ---: | --- |
| US, 1h / 4h / 24h | `sudoku` | 63,000 | ±50% |
| US, 7d and longer | `gpts` | 3,500 | ±50% |
| Canada (`CA`) | `sudoku` | 12,000 | ±75% |
| United Kingdom (`GB`) | `sudoku` | 27,000 | ±75% |
| Australia (`AU`) | `sudoku` | 8,100 | ±75% |
| Germany (`DE`) | `sudoku` | 27,000 | ±75% |
| France (`FR`) | `sudoku` | 20,000 | ±75% |
| Japan (`JP`) | `ナンプレ` | 22,000 | ±75% |
| India (`IN`) | `calculator` | 300,000 | ±75% |
| Worldwide (`""`) | `sudoku` | 220,000 | ±75% |

Outside the US the listed anchor serves both short and long windows. An explicit query anchor, fixed plugin anchor or `windowAnchors` setting takes priority. It still needs a baseline for the query's region; selecting US `gpts` for Canada does not apply the US search volume there.

These bands are deliberately broad assumptions about model and source uncertainty, **not statistical confidence intervals or accuracy guarantees**. The live reliability gate also applies: an anchor's non-gap mean must be at least 1, at least 25% of its non-gap points must be nonzero, and the term must have usable data. A sparse term or anchor can still return `null` in a supported region. The 1h and 4h windows use the short-window anchor; the new regional validation directly measured 24h and 7d, not every shorter window or historical range.

## Sources and conversion

New daily values use `monthly / (365.25 / 12)` rounded to two significant digits. Germany and France use the geometric midpoint of their two direct keyword-volume estimates before conversion. No country is scaled from US population, US interest scores or website visits. Worldwide uses its own reported global keyword volume, not a sum of the listed countries.

| Region / term | Reported monthly searches | Source | Measurement period |
| --- | ---: | --- | --- |
| CA / sudoku | 368,000 | [seodata.dev](https://api.seodata.dev/v1/keyword?q=sudoku&country=ca) | Not supplied |
| GB / sudoku | 823,000 | [seodata.dev](https://api.seodata.dev/v1/keyword?q=sudoku&country=gb) | Not supplied |
| AU / sudoku | 246,000 | [seodata.dev](https://api.seodata.dev/v1/keyword?q=sudoku&country=au) | Not supplied |
| DE / sudoku | 1,000,000; 673,000 | [seodata.dev](https://api.seodata.dev/v1/keyword?q=sudoku&country=de), [Semrush keyword table for zeit.de](https://www.semrush.com/website/zeit.de/overview/) | Not supplied; October 2026 |
| FR / sudoku | 550,000; 673,000 | [seodata.dev](https://api.seodata.dev/v1/keyword?q=sudoku&country=fr), [Semrush keyword table for e-sudoku.fr](https://www.semrush.com/website/e-sudoku.fr/overview/) | Not supplied; October 2026 |
| JP / ナンプレ | 673,000 | [Semrush keyword table for sudoku.name](https://de.semrush.com/website/sudoku.name/overview/) | September 2026 indexed report |
| IN / calculator | 9,140,000 | [seodata.dev](https://api.seodata.dev/v1/keyword?q=calculator&country=in) | Not supplied |
| Worldwide / sudoku | 6,640,000 | [The Word Finder's reported Ahrefs export](https://www.thewordfinder.com/blog/5000-years-of-games-how-we-got-from-senet-to-wordle/) | July 2026 |

The seodata API provides keyword-volume estimates but omits the measurement range and close-variant list. Its `cached_at` timestamp is not a measurement date. [Google Ads documents](https://developers.google.com/google-ads/api/docs/keyword-planning/generate-historical-metrics) that historical keyword metrics can combine close variants. Do not treat these estimates as exact counts for a literal search string. The Japanese number is retained in the search index of Semrush's German-language September report; the current English-language October top-five table no longer lists that keyword. The global figure is the publisher's reported Ahrefs export, not a live Ahrefs API response. Both source periods remain explicit in the catalog.

The wider ±75% band acknowledges these limitations and disagreement with cross-keyword checks. Separate calculator-based estimates and 3-month Trends ratios were examined; they were not substituted for direct regional keyword volumes. The Worldwide calculator/translate checks imply roughly 3.3–7.8 million monthly sudoku searches, showing why the global figure should not be presented as precise. US derivation and its original sources are in [the reference](reference.md#calibration-and-the-anchor).

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
