# google-trends-for-agent · Agent API

面向 Agent 的公开表面只有 **四个 MCP 工具**（及同名语义的 CLI）。`trends_ask` / `trends_compare` / `trends_snapshot` 默认 **美国 · 近 24 小时 · Web · 全部分类**；`trends_now` 默认拉 **30 国** 的 Trending Now（`hours=24`）。`trends_snapshot` 还会用共享尺度锚点（默认 `gpts`）把 0–100 兴趣换算成每日搜索量估计，并始终附带一条 **`now 7-d`** 曲线（`chart7d` / `traffic7d`）。默认信封为 Agent 做了瘦身：`trends_ask` 不返回完整 `interest.points`（`points: true` / `--points` 才返回），`trends_snapshot` 不内联 SVG 文本（`svg: true` / `--svg` 才返回，`chart.path` 仍会写入）。图表时间轴默认使用 **UTC**，可用 `tz` / `--tz` / 库 `timeZone` 或 `GTFA_TZ` 指定 IANA 时区。`trends_ask`（`validate: true`）与 `trends_snapshot` 共用同一套标定公式和锚点可靠性门。本文只描述当前 HEAD 的入参与稳定输出信封，字段以 `src/mcp.ts` / `src/trends-snapshot.ts` / `src/calibration.ts` 为准。英文总览与安装见 [README](../README.md)。

---

## 共用约定

| 约定 | 说明 |
| --- | --- |
| 键顺序 | `ok` → `schemaVersion` → `status` → 工具正文 → `error?` → `meta` |
| `schemaVersion` | 固定为 `1` |
| `ok: false` | 同时设置 MCP `isError: true` |
| 错误对象 | `error: { code, message, retryAfterSec? }` |
| Schema 拒收 | 参数未过 Zod 时同样返回上述信封，`error.code` 为 `INVALID_INPUT` |
| Explore `time` 枚举 | `now 1-H` · `now 4-H` · `now 1-d` · `now 7-d` · `today 1-m` · `today 3-m` · `today 12-m` · `today 5-y` · `all` |
| 图表时区 | 默认 `UTC`；显式 `tz` / `--tz` / `timeZone` > `GTFA_TZ` > `UTC`；用 `Intl.DateTimeFormat` 校验并规范化 IANA 名称（大小写变体映射到同一时区，共用标签与图表文件），非法名称返回 `INVALID_INPUT` |
| Web / 分类 | MCP 固定 Web、`category=0`（不可从这四个工具改） |

**CLI 对照**

| CLI | MCP |
| --- | --- |
| `gtfa ask <term> [--fresh] [--validate] [--diff …] [--points]` | `trends_ask`（`--diff` 强制 JSON 输出） |
| `gtfa snapshot <term> [--json] [--svg] [--tz IANA]` | `trends_snapshot` |
| `gtfa compare a b …` 或 `--query a --query b` | `trends_compare` |
| `gtfa now --geo SG [--hours 24] [--limit 10]` | `trends_now` |

> `now` 的 `--hours` 是 Trending Now 窗口（4 / 24 / 48 / 168），**不是** Explore 的 `time`。

---

## `trends_ask` — 查一个词

兴趣曲线 + Popular / Rising 相关查询 + 地区；可复用快照、出裁决、相对上次快照做 diff。

### 入参

| 参数 | 类型 | 必填 | 默认 | 含义 |
| --- | --- | --- | --- | --- |
| `term` | string（1–100，trim） | 是 | — | 要查的词 |
| `geo` | string | 否 | `US` | 国家 / 地区（如 `US-CA`） |
| `time` | 上表枚举 | 否 | `now 1-d` | Explore 时间窗 |
| `fresh` | boolean | 否 | `false` | `false`：复用 &lt;360 分钟的快照；`true`：强制现拉 |
| `validate` | boolean | 否 | `false` | `true`：附加裁决（内部锚点 `gpts`） |
| `points` | boolean | 否 | `false` | `true`：返回完整 `interest.points`；默认省略以控制 Agent 上下文 |

### 请求示例

```json
{
  "name": "trends_ask",
  "arguments": {
    "term": "nano banana",
    "geo": "US",
    "time": "now 1-d",
    "fresh": false,
    "validate": true
  }
}
```

### 输出示例（含 `validate`；`diff` 有上次快照时）

```json
{
  "ok": true,
  "schemaVersion": 1,
  "status": "ok",
  "term": "nano banana",
  "summary": "nano banana: latest 20, peak 42; 1 popular, 2 rising; top rising \"nano banana pro\"",
  "filter": {
    "geo": "US",
    "time": "now 1-d",
    "category": 0,
    "property": "web"
  },
  "interest": {
    "average": 31,
    "latest": 42,
    "settledLatest": 20,
    "peak": 42,
    "gapCount": 0
  },
  "tables": {
    "popular": [
      { "rank": 1, "query": "nano banana ai", "value": 100, "formattedValue": "100" }
    ],
    "rising": [
      {
        "rank": 1,
        "query": "nano banana pro",
        "value": 250,
        "formattedValue": "+250%",
        "breakout": false
      },
      {
        "rank": 2,
        "query": "nano banana download",
        "value": 5000,
        "formattedValue": "Breakout",
        "breakout": true
      }
    ]
  },
  "regions": [
    { "geo": "US-CA", "name": "California", "value": 100 }
  ],
  "verdict": {
    "label": "rising",
    "confidence": "mid",
    "reasons": ["Settled tail mean >= 1.5 × earlier mean"],
    "traffic": {
      "unit": "searches/day",
      "average": 132,
      "latest": 180,
      "settledLatest": 132,
      "peak": 180,
      "low": 66,
      "high": 198,
      "gapCount": 0
    },
    "anchor": {
      "term": "gpts",
      "ratio": 0.24,
      "band": "mid",
      "note": "Anchor calibration estimate; not measured volume"
    }
  },
  "diff": {
    "term": "nano banana",
    "filter": { "geo": "US", "time": "now 1-d", "category": 0, "property": "" },
    "from": "<上一快照 id>",
    "to": "<本次快照 id>",
    "newPopular": ["nano banana ai"],
    "droppedPopular": [],
    "newRising": [
      { "rank": 2, "query": "nano banana download", "value": 5000, "breakout": true }
    ],
    "risingUp": [{ "query": "nano banana pro", "from": 180, "to": 250 }],
    "regionMoves": [{ "code": "US-CA", "fromRank": 2, "toRank": 1 }],
    "interestDelta": { "latestFrom": 12, "latestTo": 20, "delta": 8 }
  },
  "meta": {
    "cached": false,
    "ageMin": 0,
    "fetchedAt": "2026-10-31T14:00:00.000Z",
    "snapshotId": "…",
    "exploreUrl": "https://trends.google.com/trends/explore?q=nano+banana&geo=US&date=now+1-d"
  }
}
```

仅查询、不裁决时没有 `verdict`。没有上次快照时：

```json
{
  "diff": null,
  "diffReason": "Need two snapshots"
}
```

`validate: true` 且裁决为 blocked（例如锚点请求被封）时：`ok: false`，`status: "blocked"`，并带 `error`（可能含 `retryAfterSec`）。

### 字段说明

| 字段 | 含义 |
| --- | --- |
| `status` | `ok` · `no_data` · `partial` · `blocked` · `error`（`no_data` / `partial` 仍可 `ok: true`） |
| `interest.points[]` | 可选；默认省略。`points: true` / `--points` 时返回相对兴趣 0–100；低样本缺口点额外带 `gap: true`，原始 `value` 仍为 `0` |
| `interest.gapCount` | 被识别为缺口的点数；没有缺口时为 `0` |
| `interest.average` / `latest` / `settledLatest` / `peak` | 均排除 `gap: true` 的点；`settledLatest` 还会去掉未 settle 的尾点 |
| `tables.popular` | Top 相关查询（约 25 行量级） |
| `tables.rising` | Rising；`value` 为增幅，`formattedValue` 为 `+N%` 或 `Breakout` |
| `regions` | 分区兴趣，高到低 |
| `verdict.label` | `spiking` · `rising` · `steady` · `flat` · `no_data` · `blocked` |
| `verdict.traffic` | **searches/day**，字段与 `trends_snapshot.traffic` 相同；与 snapshot 共用 `traffic = score ÷ anchorLevel × dailySearches`。无标定或锚点可靠性门失败时数值字段为 `null` |
| `verdict.warnings` | 可选；锚点过稀/过弱时包含 `anchor too sparse/weak for calibration; traffic omitted` |
| `diff` | 相对同 term+filter 的上一份快照；始终返回（或 `null`） |
| `diff` 字段 | 即库函数 `diffSnapshots(prev, next)` 原样返回（MCP 不裁剪）：`term`、`filter{geo,time,category,property,hl?}`（快照内部 filter，web 搜索时 `property` 为 `""`，与顶层 `filter.property: "web"` 不同）、`from` / `to`（上一 / 本次快照 id）、`newPopular[]`（query 字符串）、`droppedPopular[]`、`newRising[{rank,query,value,breakout}]`、`risingUp[{query,from,to}]`、`regionMoves[{code,fromRank,toRank}]`、`interestDelta{latestFrom,latestTo,delta}`（基于 `settledLatest`） |
| `interest` 一致性 | `peak` = 所有非缺口点最大值；`latest` = 最后一个非缺口点；`settledLatest` = 去掉未定型尾点并排除缺口后的最后一点（`now *` 窗口去掉 1 点）；`summary` 里的 latest 即 `settledLatest` |
| `meta.cached` | `true` = 复用了本地快照 |
| `meta.warnings` | 上游 `partial` 响应会保留其 warnings；另有低样本缺口（`interest.gapCount > 0`）排除说明 |

**低样本缺口（gap）规则：** Google 在低样本曲线（尤其 `now` / 1 天窗口）偶尔会把中间的点返回为 `0`。当整条曲线**超过 50% 的点非零**，且某个 `0` 点位于**第一个非零点与最后一个非零点之间**时，该点标记为 `gap: true`；开头/结尾连续为 `0` 的区间视为真实零，不标 gap。缺口点的原始 `value` 保持 `0`，但会从 `average`、`latest` / `settledLatest`、`peak` 以及裁决（verdict）计算中排除，并计入 `interest.gapCount`；`gapCount > 0` 时 `meta.warnings` 会提示。顶层 `filter.property` 在快照属性为空字符串时统一输出 `"web"`（MCP 与 CLI 相同）。

---

## 共享标定公式与锚点可靠性门

`trends_ask`（`validate: true`）和 `trends_snapshot` 调用同一个纯函数（`src/calibration.ts`），因此同样的 term / anchor 对比会得到相同的 `ratio` 和相同的每日流量带：

```text
anchorLevel = mean(non-gap anchor scores)
factor      = anchorDailySearches / anchorLevel
traffic     = round(score × factor)          # unit: searches/day
ratio       = round2(mean(non-gap term scores) / anchorLevel)
```

- 两个均值都排除 `gap: true` 的低样本零点；`traffic` 使用完整对比窗口，而不是只看 settled 尾段。
- **锚点可靠性门**：至少 1 个非 gap 锚点、`anchorLevel ≥ 1`（Trends 整数刻度）、且非 gap 锚点中至少 **25%** 非零。失败时：`anchor.level` 保留 2 位小数（例如 `0.18`，不会四舍五入成 `0`），`ratio: null`，`traffic` 数值字段全为 `null`（形状不变），并在 `anchor.note` / `meta.warnings` / `verdict.warnings` 写 `anchor too sparse/weak for calibration; traffic omitted`。裁决仍可使用 related-query / 形状信号。

---

## `trends_snapshot` — 把兴趣换算成每日搜索量

一次共享尺度的 `[term, anchor]` 兴趣对比（同一个 0–100 标尺），加上该 term 的 Popular / Rising 相关查询，换算成 **searches/day** 估计、趋势裁决和 SVG 折线图（默认只给 `chart.path`，`svg: true` / `--svg` 才内联文本）。请求窗口对应 `chart` / `traffic` / `series`；同时始终附带 **`now 7-d`** 的 `chart7d` / `traffic7d`，用同一锚点标定方式换算。默认锚点为美国 `gpts`（550 次/日，±50%），这是**标定估计，不是实测流量**。

### 入参

| 参数 | 类型 | 必填 | 默认 | 含义 |
| --- | --- | --- | --- | --- |
| `term` | string（1–100，trim） | 是 | — | 要估算的词 |
| `geo` | string | 否 | `US` | 国家 / 地区（如 `US-CA`） |
| `time` | 上表枚举 | 否 | `now 1-d` | Explore 时间窗；与 `trends_ask` 相同 |
| `anchor` | string（1–100，trim） | 否 | `gpts` | 共享尺度锚点词；默认锚点仅对 `US` 有内建标定 |
| `fresh` | boolean | 否 | `false` | `false`：复用 &lt;360 分钟的同类快照；`true`：强制现拉 |
| `svg` | boolean | 否 | `false` | `true`：内联 `chart.svg` / `chart7d.svg` 文本；默认 `svg: ""`，但 `path` 仍会写入 |
| `tz` | IANA string | 否 | `GTFA_TZ`，再退回 `UTC` | 图表时间轴时区（如 `Asia/Shanghai`）；非法名称返回 `INVALID_INPUT` |

### 请求示例

```json
{
  "name": "trends_snapshot",
  "arguments": {
    "term": "Astra",
    "geo": "US",
    "time": "now 1-d",
    "anchor": "gpts",
    "fresh": false,
    "tz": "Asia/Shanghai"
  }
}
```

### 输出示例

```json
{
  "ok": true,
  "schemaVersion": 1,
  "status": "ok",
  "term": "Astra",
  "summary": "Astra ≈ 319 searches/day (US·24h), 0.58× gpts; rising",
  "filter": { "geo": "US", "time": "now 1-d", "category": 0, "property": "web" },
  "anchor": {
    "term": "gpts",
    "dailySearches": 550,
    "tolerance": 0.5,
    "level": 100,
    "ratio": 0.58,
    "source": "baseline",
    "note": "Anchor calibration estimate; not measured volume"
  },
  "traffic": {
    "unit": "searches/day",
    "average": 319,
    "latest": 440,
    "settledLatest": 330,
    "peak": 440,
    "low": 160,
    "high": 479,
    "gapCount": 1
  },
  "series": {
    "points": [
      { "t": "2026-10-31T00:00:00.000Z", "score": 40, "traffic": 220 },
      { "t": "2026-10-31T01:00:00.000Z", "score": 0, "traffic": 0, "gap": true },
      { "t": "2026-10-31T02:00:00.000Z", "score": 50, "traffic": 275 }
    ],
    "anchorPoints": [
      { "t": "2026-10-31T00:00:00.000Z", "score": 100 },
      { "t": "2026-10-31T01:00:00.000Z", "score": 0 }
    ]
  },
  "chart": {
    "svg": "",
    "path": ".gtfa/charts/<snapshotId>-<tz-slug>-<sha1-8>.svg"
  },
  "chart7d": {
    "svg": "",
    "path": ".gtfa/charts/<7dSnapshotId>-<tz-slug>-<sha1-8>.svg"
  },
  "traffic7d": {
    "unit": "searches/day",
    "average": 275,
    "latest": 330,
    "settledLatest": 440,
    "peak": 440,
    "low": 138,
    "high": 413,
    "gapCount": 1
  },
  "tables": {
    "popular": [
      { "rank": 1, "query": "astra app", "value": 100, "formattedValue": "100", "estDaily": 319 },
      { "rank": 2, "query": "astra ai", "value": 50, "formattedValue": "50", "estDaily": 160 }
    ],
    "rising": [
      { "rank": 1, "query": "astra ai", "value": 250, "formattedValue": "+250%", "breakout": false, "estDaily": 160 },
      { "rank": 2, "query": "astra new", "value": 5000, "formattedValue": "Breakout", "breakout": true, "estDaily": null }
    ]
  },
  "verdict": {
    "label": "rising",
    "confidence": "mid",
    "reasons": ["Breakout related queries"],
    "prioritize": true
  },
  "meta": {
    "cached": false,
    "ageMin": 0,
    "fetchedAt": "2026-10-31T05:00:00.000Z",
    "snapshotId": "…",
    "exploreUrl": "https://trends.google.com/trends/explore?q=Astra&geo=US&date=now+1-d&cat=0&gprop=web"
  }
}
```

### 字段说明

| 字段 | 含义 |
| --- | --- |
| `status` | `ok` · `no_data` · `partial` · `blocked` · `error`（`no_data` / `partial` 仍可 `ok: true`） |
| `summary` | 单行摘要；无标定时写明 `no calibrated traffic` |
| `anchor` | `term` / `dailySearches` / `tolerance` / `level`（锚点窗口均值，已排除 gap；保留 2 位小数，稀疏时例如 `0.18` 而不是 `0`）/ `ratio`（term 均值 ÷ 锚点均值，2 位小数；锚点可靠性门失败时为 `null`）/ `source: "baseline"` / `note` |
| `traffic` | `unit: "searches/day"`；`average` / `latest` / `settledLatest` / `peak` 排除 gap；`low` / `high` 由 `average × (1±tolerance)` 取整；`gapCount` |
| `series.points` | 原始 0–100 `score` 与逐点 `traffic`；gap 点带 `gap: true`（原始 `score` 仍为 0） |
| `series.anchorPoints` | 锚点原始 `{t, score}`；同一次对比、同一标尺 |
| `chart.svg` | 默认 `""`（不内联，控制 Agent 上下文）；`svg: true` / `--svg` 时返回约 720×280 的内联 SVG（时间轴使用规范化后的 IANA 时区，默认 `UTC`；gap 点不连线，峰值 / latest 带时间标记，锚点虚线；标题 / aria / `<title>` 显示时区标签，如 `(UTC)`、`(Asia/Shanghai)`） |
| `chart.path` | 写入 `.gtfa/charts/<snapshotId>-<tz-slug>-<sha1-8>.svg` 的路径（时区 slug 如 `utc-bdfd4d8d`、`asia-shanghai-b485a3cf`；短 SHA-1 后缀基于规范化 IANA 名称并避免不同时区碰撞）；`null` 表示文件写入被禁用/失败 |
| `chart7d` | 始终存在的 `now 7-d` 曲线，形状与 `chart` 相同（`{ svg, path }`）；`svg` 默认 `""`，`path` 仍写入。7d 拉取失败时为 `{ "svg": "", "path": null }` 并写入 warning |
| `traffic7d` | 始终存在的 `now 7-d` 流量块，字段与 `traffic` 完全相同；用同一 `gpts` 基线（550 次/日，±50%）和同一 gap 排除规则标定；7d 拉取失败时数值字段为 `null`、`gapCount: 0` |
| `tables.popular[].estDaily` | 以 term 窗口平均日流量为顶行基准：`round(value / 100 × traffic.average)` |
| `tables.rising[]` | 保留 `formattedValue` / `breakout`；`estDaily` 仅当同一查询也出现在 Popular 中时可推导，否则 `null` |
| `verdict.label` | `rising` · `spiking` · `steady` · `fading` · `no_data` |
| `verdict.prioritize` | `traffic.settledLatest >= 300`；无标定时为 `false` |
| `meta` | `cached` / `ageMin` / `fetchedAt` / `snapshotId` / `exploreUrl` / 可选 `warnings`（上游 partial、7d 不可用、gap 排除等） |

**换算公式**（所有流量取整）：

```text
anchorLevel   = mean(anchor scores, 排除 gap)
factor        = anchorDailySearches / anchorLevel
traffic_i     = round(termScore_i × factor)
average       = round(mean(non-gap traffic_i))
low / high    = round(average × (1 - tolerance)) / round(average × (1 + tolerance))
ratio         = round2(mean(non-gap term scores) / anchorLevel)
published.est = round(popular.value / 100 × average)

可靠性门: anchorLevel >= 1 且 非gap锚点非零比例 >= 25%
失败 => ratio = null, traffic 数值 = null, warning = anchor too sparse/weak for calibration; traffic omitted
```

内建默认锚点为 `{"term":"gpts","dailySearches":550,"geo":"US","tolerance":0.5}`（约 16.5k/月）。`examples/baselines.json` 可覆盖；库调用可用 `baselines` 传入同结构。**没有匹配 `geo + anchor` 的标定时**（例如 `geo: "JP"`），或**锚点可靠性门失败时**，`traffic` / `traffic7d` 的数值字段和 `estDaily` 全部为 `null`，`anchor.note` / `meta.warnings` 会说明原因，但 `summary`、`series`、`chart`、`chart7d` 仍会返回。`trends_ask`（`validate: true`）使用完全相同的公式与门，`verdict.traffic` 为日频。

**注意事项：**

- “searches/day”是由兴趣比例 × 锚点标定推出的**估计**，不是 Google 实测搜索量；锚点本身也有误差，`low` / `high` 只反映 `tolerance`。
- 锚点与被查词的 0–100 标尺来自同一次 `[term, anchor]` 对比；不同 `geo` / `time` / `anchor` 的流量不可直接横比。
- 请求窗口不是 `now 7-d` 时，会额外做一次 `[term, anchor]` 的 `now 7-d` Explore 对比（与主窗口并行）；Popular / Rising 表仍只来自主窗口，不会为 7d 重复拉表。主窗口本身就是 `now 7-d` 时，`chart7d` 直接复用主 `chart`，不产生第二次上游请求。
- gap 点（见上一节规则）不参与 `anchorLevel`、流量聚合、裁决和折线连接；主窗口与 7d 窗口各自独立排除 gap。
- `fresh: false` 只复用同 term + filter + anchor 的快照；`blocked` 快照永不复用。
- 图表时间轴默认 `UTC`；显式 `tz`（MCP）/ `--tz`（CLI）/ `timeZone`（库）优先于 `GTFA_TZ`，都没有时为 `UTC`。时区通过 `Intl.DateTimeFormat` 的 `timeZone` 计算日历字段（正确处理 DST），而不是固定偏移；非法 IANA 名称返回 `INVALID_INPUT`。
- 图文件写在 `.gtfa/charts/`（MCP 进程可用 `GTFA_CHART_DIR` 覆盖，快照目录可用 `GTFA_SNAPSHOT_DIR` 覆盖）；`chart` 与 `chart7d` 各自使用对应快照 ID 加时区 slug 与短 SHA-1 哈希的 `.svg`（如 `traffic-fixture-utc-bdfd4d8d.svg` / `traffic-fixture-asia-shanghai-b485a3cf.svg`；主窗口为 `now 7-d` 时共用同一文件）。哈希基于规范化 IANA 时区名，大小写变体共享同一文件，而 `Etc/GMT+1` 与 `Etc/GMT-1` 会得到不同文件名。若目录不可写，对应 `path` 为 `null`；默认不内联 SVG，需要文本时设置 `svg: true` / `--svg`。
- 7d 拉取失败（`weekError` 或没有 7d 快照）时，`chart7d` / `traffic7d` **仍会返回**：`chart7d: { svg: "", path: null }`，`traffic7d` 数值全为 `null`、`gapCount: 0`，并在 `meta.warnings` 说明原因。

---

## `trends_compare` — 对比 2–5 个词

相对兴趣对比（例如候选词 vs 锚点）。只拉 `interestOverTime`，不附带 related 表。

### 入参

| 参数 | 类型 | 必填 | 默认 | 含义 |
| --- | --- | --- | --- | --- |
| `keywords` | string[2–5]，每项 1–100 | 是 | — | 要对比的词 |
| `geo` | string | 否 | `US` | 国家 / 地区 |
| `time` | Explore 枚举 | 否 | `now 1-d` | 时间窗 |

> **去重：** trim + 大小写折叠后若有重复，直接 `INVALID_INPUT`，不发请求。

### 请求示例

```json
{
  "name": "trends_compare",
  "arguments": {
    "keywords": ["nano banana", "gpts"],
    "geo": "US",
    "time": "now 1-d"
  }
}
```

### 输出示例

```json
{
  "ok": true,
  "schemaVersion": 1,
  "status": "ok",
  "filter": { "geo": "US", "time": "now 1-d" },
  "summary": "nano banana vs gpts (US·now 1-d): nano banana latest 40/peak 40, gpts latest 100/peak 100",
  "series": [
    {
      "keyword": "nano banana",
      "points": [
        { "t": "2026-10-30T00:00:00.000Z", "value": 18 },
        { "t": "2026-10-31T00:00:00.000Z", "value": 40 }
      ],
      "average": 29,
      "latest": 40,
      "peak": 40
    },
    {
      "keyword": "gpts",
      "points": [
        { "t": "2026-10-30T00:00:00.000Z", "value": 80 },
        { "t": "2026-10-31T00:00:00.000Z", "value": 100 }
      ],
      "average": 90,
      "latest": 100,
      "peak": 100
    }
  ],
  "meta": {
    "fetchedAt": "2026-10-31T14:00:00.000Z",
    "upstreamRequests": 2,
    "durationMs": 1200,
    "warnings": []
  }
}
```

### 字段说明

| 字段 | 含义 |
| --- | --- |
| `status` | `ok` · `partial` · `error` |
| `summary` | 单行摘要，列出每个词的 latest / peak |
| `series` | 按入参顺序；同一次调用内数值相对 0–100 |
| `series[].average` | 该词平均兴趣（有上游 averages 则用之） |
| `series[].latest` / `peak` | gap-aware 的最后一个非缺口值 / 最大非缺口值 |
| `error` | 失败时出现 |
| `meta` | 请求元数据 |

---

## `trends_now` — 各国正在热搜什么

Google Trending Now（按国顺序拉取；遇 block 即停后续国家）。

### 入参

| 参数 | 类型 | 必填 | 默认 | 含义 |
| --- | --- | --- | --- | --- |
| `geos` | `string[]` · `"default"` · `"all"` | 否 | `"default"`（30 国） | 国家列表；支持列表写在工具 description |
| `hours` | `4` · `24` · `48` · `168` | 否 | `24` | **Trending 窗口（小时）**，勿与 Explore `time` 混淆 |
| `limit` | integer ≥ 0 | 否 | `10` | 每国条数 |

### 请求示例

```json
{
  "name": "trends_now",
  "arguments": {
    "geos": ["SG", "US"],
    "hours": 24,
    "limit": 5
  }
}
```

### 输出示例

```json
{
  "ok": true,
  "schemaVersion": 1,
  "status": "ok",
  "hours": 24,
  "geos": ["SG", "US"],
  "summary": { "geos": 2, "ok": 2, "failed": 0 },
  "byGeo": [
    {
      "geo": "SG",
      "ok": true,
      "fetchedAt": "2026-10-31T14:00:00.000Z",
      "items": [
        {
          "rank": 1,
          "title": "Example Topic",
          "query": "example topic",
          "traffic": 20000,
          "trafficLabel": "20K+",
          "growthPct": 150,
          "startedAt": "2026-10-31T08:00:00.000Z",
          "endedAt": null,
          "active": true,
          "categories": ["Technology"],
          "relatedQueries": ["example app"],
          "newsCount": 3,
          "link": "https://trends.google.com/trends/explore?q=example+topic&geo=SG&date=now+1-d"
        }
      ]
    },
    {
      "geo": "US",
      "ok": true,
      "fetchedAt": "2026-10-31T14:00:01.000Z",
      "items": [
        {
          "rank": 1,
          "title": "Example Game",
          "query": "example game",
          "traffic": 50000,
          "trafficLabel": "50K+",
          "growthPct": 400,
          "startedAt": "2026-10-31T10:00:00.000Z",
          "endedAt": null,
          "active": true,
          "categories": ["Sports"],
          "relatedQueries": ["example game score"],
          "newsCount": 5,
          "link": "https://trends.google.com/trends/explore?q=example+game&geo=US&date=now+1-d"
        }
      ]
    }
  ],
  "meta": { "fetchedAt": "2026-10-31T14:00:01.000Z" }
}
```

若有国家失败，顶层可带第一个失败的 `error`；该国在 `byGeo` 里 `ok: false` 并自带 `error`。

### 字段说明

| 字段 | 含义 |
| --- | --- |
| `status` | `ok` · `partial` · `error` |
| `summary` | 请求国数 / 成功 / 失败 |
| `byGeo[].items[].traffic` | 约略搜索量（桶），不是 Explore 的 0–100 |
| `trafficLabel` | 如 `20K+` |
| `link` | 构造的 Explore URL |

**和库函数 diff：** MCP 字段是 `traffic` / `trafficLabel`，库的 `diffTrending` 要 `volume` / `volumeLabel`。请先：

```js
import { trendsNowToTrendingResponses, diffTrendsNow, diffTrending } from 'google-trends-for-agent';

const [sg] = trendsNowToTrendingResponses(savedEnvelope);
diffTrending(prevSg, nextSg);
// 或多国：
diffTrendsNow(prevEnvelope, nextEnvelope);
```