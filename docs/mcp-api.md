# google-trends-for-agent · Agent API

面向 Agent 的公开表面只有 **四个 MCP 工具**（及同名语义的 CLI）。`trends_ask` / `trends_compare` / `trends_snapshot` 默认 **美国 · 近 24 小时 · Web · 全部分类**；`trends_now` 默认拉 **30 国** 的 Trending Now（`hours=24`）。`trends_snapshot` 还会用共享尺度锚点把 0–100 兴趣换算成每日搜索量估计；锚点按窗口自动选择（`now 1-H` / `now 4-H` / `now 1-d` 用 `sudoku`，`now 7-d` 及以上用 `gpts`）。正常返回时，`chart7d` / `traffic7d` / `anchor7d` 字段形状固定。主窗口不是 `now 7-d` 时，主尝试结束后，只要结果不是 `BLOCKED` / `RATE_LIMITED`，就顺序尝试一次额外的 `now 7-d` 请求；普通 `NETWORK_ERROR` 等错误本身不会阻止该尝试。主窗口为这两类停止错误时不发额外请求，仍返回空图、null 流量、基线信息与 warning。调用方取消或整体 deadline 会向上传播，不承诺返回该正常信封。默认信封为 Agent 做了瘦身：`trends_ask` 不返回完整 `interest.points`（`points: true` / `--points` 才返回），`trends_snapshot` 不内联 SVG 文本（`svg: true` / `--svg` 才返回，`chart.path` 仍会写入）。图表时间轴默认使用 **UTC**，可用 `tz` / `--tz` / 库 `timeZone` 或 `GTFA_TZ` 指定 IANA 时区。`trends_ask`（`validate: true`）与 `trends_snapshot` 共用同一套标定公式和锚点可靠性门。本文只描述本版本的入参与稳定输出信封，字段以 `src/mcp.ts` / `src/trends-snapshot.ts` / `src/calibration.ts` 为准。英文总览与安装见 [README](../README.md)。

所有内建及 version 2 用户标定基线当前只适用于 **Web、category 0**。CLI 将 `property` 过滤为其他值或将 `category` 设为非 0 时仍可返回相对兴趣，`traffic` / `traffic7d` 对象继续存在，但其中的数值字段全为 `null`，并在 warning 中说明没有匹配的标定；version 2 格式不因此扩展。

**低样本门**：`interest.average` < 1 且 Popular/Rising 两表都为空时，按 `no_data` 处理，置信度为 `low`，流量数值（含峰值和序列流量）为 `null`，不判为 rising/high。低均值但有相关查询证据时不触发此门。ask 与 snapshot 的 `verdict.label` 统一为 `spiking` · `rising` · `steady` · `flat` · `no_data` · `blocked`；`flat` 包含下降情况。

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
| `geo` 匹配 | 缓存、filter 和基线匹配先 trim 再转大写；空字符串 `""` 保留为 Worldwide，不替换成 `US`。当前 `parseBaselines` 拒绝空 `geo` 锚点行，因此 Worldwide 不能用用户基线校准 |
| Web / 分类 | MCP 固定 Web、`category=0`（不可从这四个工具改） |
| `timeoutMs` | 可选，整数 1000–60000。Explore 工具（ask / snapshot / compare）默认 30000 ms，`trends_now` 默认 15000 ms；doctor 仍为 8000 ms。CLI 的 `ask` / `snapshot` / `doctor` 使用 `--timeout MS`；dsh 与 Actor 继续使用 `timeoutMs`。 |

**CLI 对照**

| CLI | MCP |
| --- | --- |
| `gtfa ask <term> [--fresh] [--validate] [--diff …] [--points] [--category N] [--property PROPERTY] [--timeout MS] [--pretty]` | `trends_ask`（`--diff` 强制 JSON 输出） |
| `gtfa snapshot <term> [--json] [--svg] [--tz IANA] [--timeout MS]` | `trends_snapshot` |
| `gtfa compare a b …` 或 `--query a --query b` | `trends_compare` |
| `gtfa now --geo SG [--hours 24] [--limit 10]` | `trends_now` |

> `now` 的 `--hours` 是 Trending Now 窗口（4 / 24 / 48 / 168），**不是** Explore 的 `time`。

`gtfa ask --pretty` 仅缩进 JSON；普通 ask、validation batch、diff 和结构化错误都会按该选项缩进，而 `ask --validate` 未传 `--json` 时仍输出表格。`--timeout MS` 是每个 Explore 请求的超时，不是整次调用的总时限。

CLI-only：`gtfa ask --validate --from` 的 JSON 结果会为每行加入 `input`，保留源 JSON 对象中的 `variants`、`source`、`url`、`firstSeen` 等元数据；这些字段不参与查询。它按每行的 `snapshotId` 回读对应诊断结果，避免并发同 term/filter 写入时拿到另一行的最新文件。MCP 信封没有这个 `input` 字段。

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
| `validate` | boolean | 否 | `false` | `true`：附加裁决；锚点按窗口自动（1h/4h/1d 用 `sudoku`，7d 及以上用 `gpts`） |
| `points` | boolean | 否 | `false` | `true`：返回完整 `interest.points`；默认省略以控制 Agent 上下文 |
| `timeoutMs` | integer（1000–60000） | 否 | 30000 | 本次命令中每个 Explore 请求的超时（毫秒） |

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
      "average": 15120,
      "latest": 20618,
      "settledLatest": 15120,
      "peak": 20618,
      "low": 7560,
      "high": 22680,
      "gapCount": 0
    },
    "anchor": {
      "term": "sudoku",
      "dailySearches": 63000,
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

`trends_ask` 将本次快照与最近一份可用的成功快照对比，缓存命中时也一样。存储键和匹配统一对关键词去除首尾空白并转小写，展示保留本次请求的拼写。只有无错误且通过低样本门的完整 `status: "ok"` 快照参与差分。失败、partial、blocked 和 no_data 快照仍写入磁盘供诊断，但不作为比较基线；仅 `ok` / `no_data` 可复用为缓存响应（默认 360 分钟），失败/partial/blocked 会重新抓取。缓存命中不会新建快照。无可用快照对时返回 `diff: null` 和明确的 `diffReason`；首次成功为 `"Need two snapshots"`，本次失败为 `"Current snapshot has no usable successful data"`，没有可用历史成功或历史不兼容时也会说明原因，不会抛出 INVALID_INPUT 或中断批量处理。设置 `fresh: true` 可拉取并保存一个新的对比点。CLI 的 `--diff` 强制拉取、保存并输出 JSON，覆盖 `--refresh`（包括 `never`）。

`validate: true` 且主词请求或共享锚点比较返回 `BLOCKED` / `RATE_LIMITED` 时，验证停止且不再发出后续上游请求：`ok: false`，`status: "blocked"`，并带相同错误码及可用的 `retryAfterSec`。

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
| `verdict.anchor` | 本窗口使用的锚点：`term` / `dailySearches`（基线，便于直接看到换算尺子）/ `ratio` / `band` / `note` |
| `verdict.warnings` | 可选；锚点过稀/过弱时包含 `anchor too sparse/weak for calibration; traffic omitted` |
| `diff` | 相对同 term+filter 的最近一份可用成功快照；始终返回（或 `null`） |
| `diff` 字段 | 有效快照对由库函数 `diffSnapshots(prev, next)` 返回（MCP 不裁剪）：`term`、`filter{geo,time,category,property,hl?}`（快照内部 filter，web 搜索时 `property` 为 `""`，与顶层 `filter.property: "web"` 不同）、`from` / `to`（上一 / 本次快照 id）、`newPopular[]`（query 字符串）、`droppedPopular[]`、`newRising[{rank,query,value,breakout}]`、`risingUp[{query,from,to}]`、`regionMoves[{code,fromRank,toRank}]`、`interestDelta{latestFrom,latestTo,delta}`（基于 `settledLatest`） |
| `interest` 一致性 | `peak` = 所有非缺口点最大值；`latest` = 最后一个非缺口点；`settledLatest` = 去掉未定型尾点并排除缺口后的最后一点（`now *` 窗口去掉 1 点）；`summary` 里的 latest 即 `settledLatest` |
| `meta.cached` | `true` = 复用了本地快照 |
| `meta.warnings` | 上游 `partial` 响应会保留其 warnings；另有低样本缺口（`interest.gapCount > 0`）排除说明 |

**低样本缺口（gap）规则：** Google 在低样本曲线（尤其 `now` / 1 天窗口）偶尔会把中间的点返回为 `0`。当整条曲线**超过 50% 的点非零**，且某个 `0` 点位于**第一个非零点与最后一个非零点之间**时，该点标记为 `gap: true`；开头/结尾连续为 `0` 的区间保留为零，不标 gap。缺口点的原始 `value` 保持 `0`，但会从 `average`、`latest` / `settledLatest`、`peak` 以及裁决（verdict）计算中排除，并计入 `interest.gapCount`；`gapCount > 0` 时 `meta.warnings` 会提示。顶层 `filter.property` 在快照属性为空字符串时统一输出 `"web"`（MCP 与 CLI 相同）。

在 `now 1-d` 窗口中，曲线尾部的点可能为 0 或偏低，这是 Google 回填尚未完成。应使用已 settle 的值和窗口平均值，不要把末尾单独一个 0 当成真实下跌。`settledLatest` 在 `now *` 窗口会先去掉 1 个尾点，再排除 gap；若连续多个尾零，仍可能剩在结果里。非 `now`、按日间隔的序列去掉 2 个尾点，其余序列去掉 1 个。平均值排除 gap，但包含尚未 settle 的尾点。该规则同时适用于兴趣值和标定后的流量；计算方式没有改动。

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

一次共享尺度的 `[term, anchor]` 兴趣对比（同一个 0–100 标尺），加上该 term 的 Popular / Rising 相关查询，换算成 **searches/day** 估计、趋势裁决和 SVG 折线图（默认只给 `chart.path`，`svg: true` / `--svg` 才内联文本）。请求窗口对应 `chart` / `traffic` / `series` / `anchor`；正常返回时，`chart7d` / `traffic7d` / `anchor7d` 字段始终存在。主窗口不是 `now 7-d` 时，主尝试结束后，只要不是 `BLOCKED` / `RATE_LIMITED` 就顺序请求该额外窗口；普通主窗口错误（如 `NETWORK_ERROR`）不会单独阻止该请求。主窗口为这两类停止错误时直接使用空图、null 流量和基线信息，不再发出 7d 请求。短窗口（`now 1-H` / `now 4-H` / `now 1-d`）自动使用美国 `sudoku`（63,000 次/日，±50%），`now 7-d` 及以上自动使用美国 `gpts`（3,500 次/日，±50%）；这是**标定估计，不是实测流量**。

### 入参

| 参数 | 类型 | 必填 | 默认 | 含义 |
| --- | --- | --- | --- | --- |
| `term` | string（1–100，trim） | 是 | — | 要估算的词 |
| `geo` | string | 否 | `US` | 国家 / 地区（如 `US-CA`） |
| `time` | 上表枚举 | 否 | `now 1-d` | Explore 时间窗；与 `trends_ask` 相同 |
| `anchor` | string（1–100，trim） | 否 | 自动 | 共享尺度锚点词。省略时按窗口自动选择（1h/4h/1d → `sudoku`，7d+ → `gpts`）；显式指定会同时用于主窗口和额外 7d 窗口。自动内建标定仅覆盖 `US` 的 Web/category 0 |
| `fresh` | boolean | 否 | `false` | `false`：复用 &lt;360 分钟的同类快照；`true`：强制现拉 |
| `svg` | boolean | 否 | `false` | `true`：内联 `chart.svg` / `chart7d.svg` 文本；默认 `svg: ""`，但 `path` 仍会写入 |
| `tz` | IANA string | 否 | `GTFA_TZ`，再退回 `UTC` | 图表时间轴时区（如 `Asia/Shanghai`）；非法名称返回 `INVALID_INPUT` |
| `timeoutMs` | integer（1000–60000） | 否 | 30000 | 主窗口及额外 7d 的每个 Explore 请求超时（毫秒） |

### 请求示例

```json
{
  "name": "trends_snapshot",
  "arguments": {
    "term": "Astra",
    "geo": "US",
    "time": "now 1-d",
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
  "summary": "Astra ≈ 36.5k searches/day (US·24h), 0.58× sudoku; rising",
  "filter": { "geo": "US", "time": "now 1-d", "category": 0, "property": "web" },
  "anchor": {
    "term": "sudoku",
    "dailySearches": 63000,
    "tolerance": 0.5,
    "level": 100,
    "ratio": 0.58,
    "source": "baseline",
    "note": "Anchor calibration estimate; not measured volume"
  },
  "anchor7d": {
    "term": "gpts",
    "dailySearches": 3500,
    "tolerance": 0.5,
    "level": 100,
    "ratio": 0.5,
    "source": "baseline",
    "note": "Anchor calibration estimate; not measured volume"
  },
  "traffic": {
    "unit": "searches/day",
    "average": 36540,
    "latest": 50400,
    "settledLatest": 37800,
    "peak": 50400,
    "low": 18270,
    "high": 54810,
    "gapCount": 1
  },
  "series": {
    "points": [
      { "t": "2026-10-31T00:00:00.000Z", "score": 40, "traffic": 25200 },
      { "t": "2026-10-31T01:00:00.000Z", "score": 0, "traffic": 0, "gap": true },
      { "t": "2026-10-31T02:00:00.000Z", "score": 50, "traffic": 31500 }
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
    "average": 1750,
    "latest": 2100,
    "settledLatest": 2800,
    "peak": 2800,
    "low": 875,
    "high": 2625,
    "gapCount": 1
  },
  "tables": {
    "popular": [
      { "rank": 1, "query": "astra app", "value": 100, "formattedValue": "100", "estDaily": null },
      { "rank": 2, "query": "astra ai", "value": 50, "formattedValue": "50", "estDaily": null }
    ],
    "rising": [
      { "rank": 1, "query": "astra ai", "value": 250, "formattedValue": "+250%", "breakout": false, "estDaily": null },
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
| `anchor` | 主窗口使用的锚点：`term` / `dailySearches` / `tolerance` / `level`（锚点窗口均值，已排除 gap；保留 2 位小数，稀疏时例如 `0.18` 而不是 `0`）/ `ratio`（term 均值 ÷ 锚点均值，2 位小数；锚点可靠性门失败时为 `null`）/ `source: "baseline"` / `note` |
| `anchor7d` | 7d 窗口使用的锚点，形状与 `anchor` 相同；主窗口已经是 `now 7-d` 时复用主快照；普通 7d 错误导致没有快照，或因主窗口 `BLOCKED` / `RATE_LIMITED` 而跳过时，只返回基线信息（`level` / `ratio` 为 `null`）。调用方取消或整体 deadline 不进入该兜底 |
| `traffic` | `unit: "searches/day"`；`average` / `latest` / `settledLatest` / `peak` 排除 gap；`low` / `high` 由 `average × (1±tolerance)` 取整；`gapCount` |
| `series.points` | 原始 0–100 `score` 与逐点 `traffic`；gap 点带 `gap: true`（原始 `score` 仍为 0） |
| `series.anchorPoints` | 锚点原始 `{t, score}`；同一次对比、同一标尺 |
| `chart.svg` | 默认 `""`（不内联，控制 Agent 上下文）；`svg: true` / `--svg` 时返回 720×300 的内联 SVG（时间轴使用规范化后的 IANA 时区，默认 `UTC`；gap 点不连线，峰值 / latest 带时间标记，锚点虚线；标题 / aria / `<title>` 显示时区标签，如 `(UTC)`、`(Asia/Shanghai)`） |
| `chart.path` | 写入 `.gtfa/charts/<snapshotId>-<tz-slug>-<sha1-8>.svg` 的路径（时区 slug 如 `utc-bdfd4d8d`、`asia-shanghai-b485a3cf`；短 SHA-1 后缀基于规范化 IANA 名称并避免不同时区碰撞）；`null` 表示文件写入被禁用/失败 |
| `chart7d` | 正常返回时固定存在的 7d 曲线字段，形状与 `chart` 相同（`{ svg, path }`）；主窗口不是 `now 7-d` 时，在主尝试结束后只要不是 `BLOCKED` / `RATE_LIMITED` 就尝试拉取。普通 7d 错误没有快照或被跳过时为 `{ "svg": "", "path": null }` 并写入 warning；调用方取消/整体 deadline 不承诺返回该字段 |
| `traffic7d` | 正常返回时固定存在的 7d 流量块，字段与 `traffic` 完全相同；成功拉取时用 `anchor7d` 的基线（默认 `gpts` 3,500 次/日，±50%）和同一 gap 排除规则标定；普通 7d 错误或跳过时数值字段为 `null`、`gapCount: 0`。调用方取消/整体 deadline 不进入该兜底 |
| `tables.popular[].estDaily` | 兼容字段，**始终为 `null`**。Popular 的 `value` 不是主词绝对量，不能据此推导每日搜索量 |
| `tables.rising[].estDaily` | 兼容字段，**始终为 `null`**。升幅 / Breakout 与主词兴趣不共享可用于绝对量换算的标尺 |
| `tables.rising[]` | 保留 `formattedValue` / `breakout`；`value` 是升幅或 Breakout 标记，不是 searches/day |
| `verdict.label` | `spiking` · `rising` · `steady` · `flat` · `no_data` · `blocked` |
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

可靠性门: anchorLevel >= 1 且 非gap锚点非零比例 >= 25%
失败 => ratio = null, traffic 数值 = null, warning = anchor too sparse/weak for calibration; traffic omitted
```

`estDaily` 不参与上述流量公式。只有 `trends_snapshot` 的 Popular/Rising 行保留该兼容字段并始终投影为 `null`；`trends_ask` 的相关词表不包含 `estDaily`。`schemaVersion` 保持不变。

内建美国锚点有两个：`gpts` **3,500 次/日**（`now 7-d` 及以上）和 `sudoku` **63,000 次/日**（`now 1-H` / `now 4-H` / `now 1-d`），都使用 ±50% tolerance。63,000 的推导：7 天共享尺度 sudoku/gpts = 18.035 → 18.035 × 3,500 ≈ 63,123；thesaurus 交叉校验 thesaurus/gpts 7.341 × 3,500 ≈ 25,694，sudoku/thesaurus 2.441 × 25,694 ≈ 62,720，两者都四舍五入到 ≈63,000，因此短窗口与 7 天窗口在同一把尺子上（gpts=3,500）。3,500 的基线由 sudoku、thesaurus、calculator 的公开关键词工具量经实测 Trends 比例反推（来源见 [reference](reference.md#calibration-and-the-anchor)）。备选：thesaurus ≈25,700/日（更接近小 AI 词，但夜间有零点）、chairs ≈143,000/日（100% 非零，但压扁极小的词）；过大的 weather / calculator / pizza 会压扁小词。方法参考 [Krazydad](https://blog.krazydad.com/2018/05/18/comparing-apples-oranges-and-futoshikis-using-google-trends/) 与 [G-TAB](https://arxiv.org/abs/2007.13861)。

`examples/baselines.json` 是 version 2：`{"version":2,"anchors":[{term,geo,dailySearches,tolerance?}],"windowAnchors":{"short"?:string,"long"?:string}}`。用 `GTFA_BASELINES=/path/to/baselines.json` 覆盖 CLI（`ask --validate` / `snapshot`）、`gtfa-mcp`（stdio 与 `--http`）和 Actor；库调用可用 `baselines` 传入同结构。版本 2 格式没有 property/category 字段，因此内建和用户锚点都只在 Web、category 0 生效，不会为其他过滤条件外推。缓存、filter 和基线匹配先把 `geo` trim 后转大写；空字符串 `""` 仍表示 Worldwide，不会回退到 `US`，但 `parseBaselines` 拒绝空 `geo` 锚点行，所以 Worldwide 没有可用的用户标定基线。归一化后的同 term+geo 用户锚点优先于内建；`windowAnchors` 的词必须存在于 `anchors` 或内建锚点中。version 1 会被拒绝，无效文件会明确报错而不是静默回退。显式 `anchor` 会同时覆盖主窗口和 7d 窗口；单次调用的 `anchor` 参数优先于 Actor 的服务级锚点设置。

**没有匹配 `geo + anchor` 的标定时**（例如内建锚点下的 `geo: "JP"`），CLI 使用非 Web property / 非 0 category，或**锚点可靠性门失败时**，`traffic` / `traffic7d` 的数值字段为 `null`，`anchor.note` / `meta.warnings` 会说明原因，但 `summary`、`series`、`chart`、`chart7d` 仍会返回。无论主标定是否成功，相关查询的 `estDaily` 都固定为 `null`。`trends_ask`（`validate: true`）使用完全相同的公式与门，`verdict.anchor` 会显示 `dailySearches`，`verdict.traffic` 为日频。

修改 `GTFA_BASELINES` 之后，请使用 CLI 的 `--fresh` 或 MCP 的 `fresh: true` 来绕过已保存的快照。

**English summary.** Anchors are automatic: `sudoku` (US 63,000/day) for `now 1-H` / `now 4-H` / `now 1-d`, `gpts` (US 3,500/day) for `now 7-d` and longer. A version 2 `baselines.json` can replace/add anchors and remap `windowAnchors.short` / `.long`; load it with `GTFA_BASELINES`. Built-in and user baselines apply only to Web search in category 0; other CLI filters keep the traffic objects with null numeric fields. `geo` is trimmed and uppercased for matching, while `""` stays Worldwide; empty-geo baseline rows are currently rejected. Only snapshot Popular/Rising `estDaily` fields remain present, and they are always `null`. An explicit `anchor` / `--anchor` wins for both the requested and 7-day windows; a per-call `anchor` beats the Actor's server-wide anchor input. `anchor7d` reports the 7-day baseline.

**注意事项：**

- “searches/day”是由兴趣比例 × 锚点标定推出的**估计**，不是 Google 实测搜索量；锚点本身也有误差，`low` / `high` 只反映 `tolerance`。
- 锚点与被查词的 0–100 标尺来自同一次 `[term, anchor]` 对比；不同 `geo` / `time` / `anchor` 的流量不可直接横比。
- 请求窗口不是 `now 7-d` 时，主尝试结束后，只要不是 `BLOCKED` / `RATE_LIMITED` 就顺序做一次 `[term, 7d anchor]` 的 `now 7-d` Explore 对比（默认 7d 锚点为 `gpts`，显式 `anchor` 时改用该锚点）；普通主窗口 `NETWORK_ERROR` 等错误本身不会阻止该尝试。Popular / Rising 表仍只来自主窗口，不会为 7d 重复拉表。主窗口为 `BLOCKED` / `RATE_LIMITED` 时跳过该额外请求。主窗口本身就是 `now 7-d` 时，`chart7d` 直接复用主 `chart`，同样不产生第二次上游请求。
- gap 点（见上一节规则）不参与 `anchorLevel`、流量聚合、裁决和折线连接；主窗口与 7d 窗口各自独立排除 gap。
- `fresh: false` 只复用同 term + filter + anchor 的快照；缓存键同时包含窗口和锚点词，因此 1d `sudoku` 与 7d `gpts` 快照不会互相命中；失败、partial 和 `blocked` 快照永不复用为缓存响应。
- 图表时间轴默认 `UTC`；显式 `tz`（MCP）/ `--tz`（CLI）/ `timeZone`（库）优先于 `GTFA_TZ`，都没有时为 `UTC`。时区通过 `Intl.DateTimeFormat` 的 `timeZone` 计算日历字段（正确处理 DST），而不是固定偏移；非法 IANA 名称返回 `INVALID_INPUT`。
- 图文件写在 `.gtfa/charts/`（MCP 进程可用 `GTFA_CHART_DIR` 覆盖，快照目录可用 `GTFA_SNAPSHOT_DIR` 覆盖）；`chart` 与 `chart7d` 各自使用对应快照 ID 加时区 slug 与短 SHA-1 哈希的 `.svg`（如 `traffic-fixture-utc-bdfd4d8d.svg` / `traffic-fixture-asia-shanghai-b485a3cf.svg`；主窗口为 `now 7-d` 时共用同一文件）。哈希基于规范化 IANA 时区名，大小写变体共享同一文件，而 `Etc/GMT+1` 与 `Etc/GMT-1` 会得到不同文件名。若目录不可写，对应 `path` 为 `null`；默认不内联 SVG，需要文本时设置 `svg: true` / `--svg`。
- 普通 7d 请求错误导致没有快照，或主窗口 `BLOCKED` / `RATE_LIMITED` 导致 7d 请求被跳过时，`weekError` 兜底保留：`chart7d: { svg: "", path: null }`，`traffic7d` 数值全为 `null`、`gapCount: 0`，`anchor7d` 只含 `term` / `dailySearches` / `tolerance` / `source` / `note`（`level` / `ratio` 为 `null`），并在 `meta.warnings` 说明原因。调用方 signal 取消或整体 deadline 会取消整个 snapshot 调用，不进入该兜底，也不承诺返回这些字段；单个 7d 请求错误仍可作为 warning/兜底保留。

---

## `trends_compare` — 对比 1–5 个词

相对兴趣对比（例如候选词 vs 锚点）。只拉 `interestOverTime`，不附带 related 表。

### 入参

| 参数 | 类型 | 必填 | 默认 | 含义 |
| --- | --- | --- | --- | --- |
| `keywords` | string[1–5]，每项 1–100 | 是 | — | 要对比的不同关键词 |
| `geo` | string | 否 | `US` | 国家 / 地区 |
| `time` | Explore 枚举 | 否 | `now 1-d` | 时间窗 |
| `timeoutMs` | integer（1000–60000） | 否 | 30000 | 本次 Explore 请求超时（毫秒） |

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
| `geos` | `string[]` · `"default"` · `"all"` | 否 | `"default"`（30 国） | 国家列表；显式列表按输入顺序大写、去重，最多 30 个 |
| `hours` | `4` · `24` · `48` · `168` | 否 | `24` | **Trending 窗口（小时）**，勿与 Explore `time` 混淆 |
| `limit` | integer ≥ 0 | 否 | `10` | 每国条数 |
| `timeoutMs` | integer（1000–60000） | 否 | 15000 | 本次 Trending Now 请求超时（毫秒） |

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
