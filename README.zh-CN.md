<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg">
    <img alt="google-trends-for-agent" src="docs/assets/logo-light.svg" width="420">
  </picture>
</p>

<p align="center"><b>面向 AI Agent 的搜索兴趣信号。一次调用，输出稳定 JSON。</b></p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

<p align="center"><a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="MIT license"></a> <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >= 20"></a> <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict"> <img src="https://img.shields.io/badge/tests-228%20passed-22c55e?style=flat-square" alt="228 tests passing"> <img src="https://img.shields.io/badge/status-unofficial-orange?style=flat-square" alt="Unofficial"></p>

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
    <td align="center"><img src="docs/assets/traffic-notion-us-7d.svg" alt="notion 美国 7 天每日搜索量图：峰值 12.0k，最新 7.8k" width="400"><br><sub><b>notion</b> · 峰值 12.0k · 最新 7.8k 次搜索/天</sub></td>
    <td align="center"><img src="docs/assets/traffic-gemini-4-carbon-us-7d.svg" alt="gemini 4 carbon 美国 7 天每日搜索量图：峰值 4.4k，最新 0" width="400"><br><sub><b>gemini 4 carbon</b> · 峰值 4.4k · 最新 0 次搜索/天</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/assets/traffic-midjourney-us-7d.svg" alt="midjourney 美国 7 天每日搜索量图：峰值 4.8k，最新 3.1k" width="400"><br><sub><b>midjourney</b> · 峰值 4.8k · 最新 3.1k 次搜索/天</sub></td>
    <td align="center"><img src="docs/assets/traffic-genie-4-us-7d.svg" alt="genie 4 美国 7 天每日搜索量图：峰值 3.6k，最新 0" width="400"><br><sub><b>genie 4</b> · 峰值 3.6k · 最新 0 次搜索/天</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/assets/traffic-perplexity-us-7d.svg" alt="perplexity 美国 7 天每日搜索量图：峰值 11.4k，最新 6.6k" width="400"><br><sub><b>perplexity</b> · 峰值 11.4k · 最新 6.6k 次搜索/天</sub></td>
    <td align="center"><img src="docs/assets/traffic-pika-h3-us-7d.svg" alt="pika h3 美国 7 天每日搜索量图：峰值 359，最新 0" width="400"><br><sub><b>pika h3</b> · 峰值 359 · 最新 0 次搜索/天</sub></td>
  </tr>
</table>
<p align="center"><sub>估算以 <code>gpts</code> 锚点 ≈ 550 次搜索/天校准；美国、近 7 天，标签使用 UTC，抓取于 2026-11-02 UTC。</sub></p>

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

## 数字如何计算

- `snapshot` 将词与锚点放在同一个 0–100 尺度上比较，再按 `traffic = round(score ÷ anchorLevel × dailySearches)` 校准。内置美国锚点为 `gpts`，**550/天**（约 16.5k/月，±50%）。
- 只有满足以下条件才会输出数值流量：至少一个非缺口锚点、`anchorLevel ≥ 1`、非缺口锚点中至少 25% 非零。稀疏的 24 小时窗口可能不达标；7 天窗口更密集。
- 这些是**基于锚点的估算**，不是 Google 实测搜索量。当请求不是 `now 7-d` 时，`traffic7d` / `chart7d` 来自另一次 7 天抓取；请求本身是 `now 7-d` 时，它们复用主快照和主图表。
- 失败保持显式：用 `ok`、`status` 和 `error.code` 代替编造数字，partial 结果会如实报告，而不是隐藏。

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
npm test          # 228 个测试
npm run typecheck
npm run build
npm run trends -- --help
```

需要 Node.js 20+。`npm run build` 会将 JavaScript 和类型声明写入 `dist/`。库入口（`src/index.ts`）导出客户端、快照、校准、图表、Trending Now 和时区 API。

## 许可证

MIT。见 [LICENSE](LICENSE)。
