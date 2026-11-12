<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg">
    <img alt="google-trends-for-agent" src="docs/assets/logo-light.svg" width="420">
  </picture>
</p>

<p align="center"><b>面向 AI Agent 的搜索兴趣信号。一次调用，输出稳定 JSON。</b></p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

<p align="center"><a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="MIT license"></a> <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >= 20"></a> <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict"> <img src="https://img.shields.io/badge/tests-262%20passed-22c55e?style=flat-square" alt="262 tests passing"> <img src="https://img.shields.io/badge/status-unofficial-orange?style=flat-square" alt="Unofficial"></p>

> [!WARNING]
> **非官方项目，与 Google 无隶属关系，也未获其背书。** 本项目调用未公开的 Google Trends Web 接口，这些接口可能随时变更或失效，使用方式也可能与 Google 服务条款冲突。请仅用于轻量、交互式分析，不要用于批量抓取，也不要将其视为 SLA。

`google-trends-for-agent` 让 Agent 和人类以可预测的方式查询搜索兴趣变化：稳定的 JSON 信封、校准后的每日搜索量估算、图表，以及明确的错误码，而不是编造数字。

<p align="center">
  <img src="docs/assets/demo-terminal.svg" alt="动画演示 gtfa snapshot 命令逐字显示，并逐行返回 Sora 的裁剪 JSON 信封" width="800">
</p>
<p align="center"><sub>真实快照输出，已裁剪。完整信封还包含序列、锚点、逐查询估算、警告和元数据。</sub></p>

## 词条图库

<table>
  <tr><th align="center">已成熟词</th><th align="center">新词与上升词</th></tr>
  <tr>
    <td align="center"><img src="docs/assets/traffic-notion-us-7d.svg" alt="notion 美国 7 天每日搜索量图：峰值 45.9k，最新 30.3k" width="400"><br><sub><b>notion</b> · 峰值 45.9k · 最新 30.3k 次搜索/天</sub></td>
    <td align="center"><img src="docs/assets/traffic-gemini-4-carbon-us-7d.svg" alt="gemini 4 carbon 美国 7 天每日搜索量图：峰值 18.0k，最新 7.7k" width="400"><br><sub><b>gemini 4 carbon</b> · 峰值 18.0k · 最新 7.7k 次搜索/天</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/assets/traffic-midjourney-us-7d.svg" alt="midjourney 美国 7 天每日搜索量图：峰值 17.9k，最新 8.1k" width="400"><br><sub><b>midjourney</b> · 峰值 17.9k · 最新 8.1k 次搜索/天</sub></td>
    <td align="center"><img src="docs/assets/traffic-genie-4-us-7d.svg" alt="genie 4 美国 7 天每日搜索量图：峰值 786，最新 0" width="400"><br><sub><b>genie 4</b> · 峰值 786 · 最新 0 次搜索/天</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/assets/traffic-perplexity-us-7d.svg" alt="perplexity 美国 7 天每日搜索量图：峰值 31.8k，最新 25.4k" width="400"><br><sub><b>perplexity</b> · 峰值 31.8k · 最新 25.4k 次搜索/天</sub></td>
    <td align="center"><img src="docs/assets/traffic-pika-h3-us-7d.svg" alt="pika h3 美国 7 天每日搜索量图：峰值 786，最新 0" width="400"><br><sub><b>pika h3</b> · 峰值 786 · 最新 0 次搜索/天</sub></td>
  </tr>
</table>
<p align="center"><sub>估算以 <code>gpts</code> 锚点 ≈ 3,500 次搜索/天校准；美国、近 7 天，标签使用 UTC，抓取于 2026-11-12 UTC。</sub></p>

## 从 GitHub 安装（Install from GitHub）

需要 Node.js 20+。无需发布到 npm；`npx` 会从 git 检出构建。

```sh
# 固定版本（推荐）
npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa --help
npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa doctor

# 最新 main
npx -y github:meka-im/google-trends-for-agent gtfa --help
```

全局安装使用同一 git 地址：`npm install -g github:meka-im/google-trends-for-agent#v0.1.0`。该包安装两个命令：CLI 使用 `gtfa`，MCP 服务器使用 `gtfa-mcp`。

## 快速开始

一次快照，返回校准后的每日搜索量：

```sh
npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa snapshot Sora --geo US --json --pretty
```

MCP 服务器默认通过 stdio 运行。让客户端指向 GitHub 包（建议固定 tag）：

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["-y", "github:meka-im/google-trends-for-agent#v0.1.0", "gtfa-mcp"]
    }
  }
}
```

如需本地 **Streamable HTTP** 端点（仅绑定 `127.0.0.1`），加上可选参数：

```sh
npx -y github:meka-im/google-trends-for-agent#v0.1.0 gtfa-mcp --http --port 4321
# MCP 端点：http://127.0.0.1:4321/mcp
```

## dsh 插件

```sh
dsh plugin --profile <name> add github:meka-im/google-trends-for-agent
```

该 bundle 为 Agent 提供四个原生工具：`trends_ask`、`trends_snapshot`、`trends_compare` 和 `trends_now`，直接在进程内调用 gtfa 核心库。没有 MCP 服务器、没有 `gtfa` CLI 子进程，也不经过 Actor 端点。随包提供的 `gtfa` skill 会告诉 Agent 何时使用哪个工具，并如实报告 `no_data` / `blocked`。

出口默认是 `local`（请求从运行 dsh 的机器发出，仍然支持 `HTTPS_PROXY`）。如需不经 Actor、直接通过 Apify 住宅代理出口，在 profile patch 中覆盖插件配置：

```yaml
# ~/.dsh/profiles/<name>/cordis.patch.yml
- id: gtfa
  config:
    egress: apify
```

然后导出 `APIFY_TOKEN`（或 `APIFY_PROXY_PASSWORD`）。Token 只从环境变量读取，不写入 YAML（无需 `!!js process.env.APIFY_TOKEN`）；插件会通过 Apify API 获取一次代理密码，并在 HTTP 429 或 Google 验证页时轮换会话。Apify 住宅代理流量按 GB 从你的 Apify 额度中扣除。

如果 pnpm 拦截了 git 检出的 `prepare` 构建（pnpm 10/11），请在 dsh 插件管理器提示中允许 `google-trends-for-agent` 后重试，或把 pnpm 打印的完整 spec 加入 `~/.dsh/profiles/<name>/pnpm-workspace.yaml` 的 `onlyBuiltDependencies`。

## 部署到 Apify（Deploy to Apify）

[![Deploy to Apify](https://img.shields.io/badge/Deploy%20to-Apify-FF9012?style=for-the-badge&logo=apify&logoColor=white)](https://console.apify.com/actors/new)

该 Actor 以 **Standby 模式**通过 **Streamable HTTP** 运行同一个 MCP 服务器，并默认通过**美国 Apify 住宅代理**访问 Google Trends。它是无法运行本地进程、也无法访问 `localhost` 的远程 Agent 的接入方式。

在本仓库执行：

```sh
apify push
```

然后把 Standby URL 和 Apify API Token 交给客户端：

```text
https://<user>--google-trends-for-agent.apify.actor/mcp
Authorization: Bearer APIFY_TOKEN
```

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

主机名里的用户名会把点号换成连字符（例如 `meka.im` 变为 `meka-im`，即 `https://meka-im--google-trends-for-agent.apify.actor/mcp`）。也可在 Actor 控制台复制准确的 Standby URL。

Actor 本身不收费。Apify 住宅代理流量按 GB 从你的 Apify 额度中扣除，费率以你的套餐和 Apify 控制台为准。请保持轻量调用：`trends_now` 查询多个国家比单次 `trends_ask` 消耗更多代理流量。Actor 配置和商店说明见 [`.actor/README.md`](.actor/README.md)。

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `trends_ask` | 兴趣、热门/上升查询、地区，可选 verdict 和 diff。 |
| `trends_snapshot` | 校准后的每日搜索量、锚点/流量块、verdict、`chart7d` / `traffic7d`。 |
| `trends_compare` | 2–5 个关键词在同一共享尺度上的相对 0–100 兴趣。 |
| `trends_now` | 按国家/地区获取 Trending Now，含排名、增长、分类和链接。 |

输入、时间窗、默认值和信封字段见[参考文档](docs/reference.md)和 [MCP 字段指南](docs/mcp-api.md)。

## CLI

| 命令 | 用途 |
| --- | --- |
| `gtfa ask <term>` | 单个词，可选 `--validate`、`--diff`、`--points` 和批量 `--from`。 |
| `gtfa snapshot <term>` | 校准流量、相关查询、verdict 和 SVG 图表。 |
| `gtfa compare <kw> <kw> [...]` | 1–5 个关键词的相对兴趣（也支持 `--query` 模式）。 |
| `gtfa now` | 按国家/地区获取 Trending Now；`--hours` 是 Now 窗口。 |
| `gtfa doctor` | 检查 Node、Google Trends 可达性、代理，并执行一次 `gpts` 美国 24 小时抓取；`--json` 供机器读取。 |

完整选项和示例见[参考文档](docs/reference.md#cli-surface)。

## 锚点与数字如何计算

`snapshot` 和 `ask --validate` 把词和一个锚点放在同一个 0–100 尺度上，再按 `traffic = round(score ÷ anchorLevel × dailySearches)` 换算。锚点按时间窗口自动选择：

| 窗口 | 锚点 | 美国基线 | 为什么用它 |
| --- | --- | --- | --- |
| `now 1-H` · `now 4-H` · `now 1-d` | `sudoku` | **63,000/天**，±50% | 全天都有人搜（24 小时内 99.4% 的点非零），短窗口也能校准；`gpts` 在短窗口里太稀疏。 |
| `now 7-d` 及更长 | `gpts` | **3,500/天**，±50% | 基准尺子，其他基线都由它推出。 |

**63,000 怎么来的：** 在 7 天共享尺度上，`sudoku` 平均是 `gpts` 的 18.035 倍，18.035 × 3,500 ≈ 63,123。经 `thesaurus` 中转（7.341 × 3,500 ≈ 25,694，再 × 2.441 ≈ 62,720）结果一致，所以短窗口和长窗口用的是同一把尺子。3,500 的基线是用 sudoku、thesaurus、calculator 的公开关键词工具量，经实测 Trends 比例反推的——来源见[参考文档](docs/reference.md#calibration-and-the-anchor)。备选：`thesaurus` ≈25,700/天；`chairs` ≈143,000/天。

- `--anchor` / MCP `anchor` 可强制两个窗口都用同一个锚点。每次快照都会返回 `anchor`（请求窗口）和 `anchor7d`（7 天校验），写明用了哪个锚点和基线。
- 用 version 2 的 `baselines.json` 覆盖或新增基线（模板：[examples/baselines.json](examples/baselines.json)）：

```json
{ "version": 2,
  "anchors": [{ "term": "sudoku", "geo": "US", "dailySearches": 63000, "tolerance": 0.5 }],
  "windowAnchors": { "short": "sudoku", "long": "gpts" } }
```

```sh
GTFA_BASELINES=./baselines.json gtfa snapshot Sora --json   # gtfa-mcp 同样读取
```

- 只有满足以下条件才输出数值流量：至少一个非缺口锚点、`anchorLevel ≥ 1`、非缺口锚点中至少 25% 非零。
- 这些是**基于锚点的估算**，不是 Google 实测搜索量。失败保持显式：用 `ok`、`status` 和 `error.code` 代替编造数字。

## 文档

- [Reference：CLI、MCP 信封、退出码、校准与限制（英文）](docs/reference.md)
- [MCP API 字段指南（中文）](docs/mcp-api.md)
- [架构图](docs/assets/architecture.svg)
- [更新日志](CHANGELOG.md)
- [基线](examples/baselines.json)

## 开发

测试使用本地 fixture 和 mock transport，不会调用 Google。

```sh
npm install
npm test          # 262 个测试
npm run typecheck
npm run build
npm run trends -- --help
```

需要 Node.js 20+。`npm run build` 会将 JavaScript 和类型声明写入 `dist/`。库入口（`src/index.ts`）导出客户端、快照、校准、图表、Trending Now 和时区 API。

## 许可证

MIT。见 [LICENSE](LICENSE)。
