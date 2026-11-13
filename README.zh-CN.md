<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg">
    <img alt="google-trends-for-agent" src="docs/assets/logo-light.svg" width="420">
  </picture>
</p>

<p align="center"><b>面向 AI Agent 的搜索兴趣信号。一次调用，输出稳定 JSON。</b></p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

<p align="center"><a href="https://apify.com/meka.im/google-trends-for-agent"><img src="https://img.shields.io/badge/Apify%20Store-google--trends--for--agent-97D700?style=flat-square" alt="Apify Store"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="MIT license"></a> <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >= 20"></a> <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict"> <img src="https://img.shields.io/badge/tests-422%20passed-22c55e?style=flat-square" alt="422 tests passing"> <img src="https://img.shields.io/badge/status-unofficial-orange?style=flat-square" alt="Unofficial"></p>

<p align="center"><a href="https://apify.com/meka.im/google-trends-for-agent"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/store-button-zh-dark.png"><img src="docs/assets/store-button-zh.png" alt="在 Apify Store 打开" width="224" height="44"></picture></a></p>

> [!WARNING]
> **非官方项目，与 Google 无隶属关系，也未获其背书。** 本项目调用未公开的 Google Trends Web 接口，这些接口可能随时变更或失效，使用方式也可能与 Google 服务条款冲突。请仅用于轻量、交互式分析，不要用于批量抓取，也不要将其视为 SLA。

`google-trends-for-agent` 让 Agent 和人类以可预测的方式查询搜索兴趣变化：稳定的 JSON 信封、校准后的每日搜索量估算、图表，以及明确的错误码，而不是编造数字。

<p align="center">
  <img src="docs/assets/demo-terminal.svg" alt="动画演示 gtfa snapshot 命令逐字显示，并逐行返回 Sora 的裁剪 JSON 信封" width="800">
</p>
<p align="center"><sub>真实快照输出，已裁剪。完整信封还包含序列、锚点、逐查询估算、警告和元数据。</sub></p>

## 选择路线

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/routes-zh-dark.png">
  <img src="docs/assets/routes-zh.png" alt="路线对比：每次调用费用、免费 $5 可用次数、启动开销、限流应对、准备">
</picture>

<sub>冷 Actor 首次调用偶尔可能长达约 2 分钟。快照、热调用和构建费用见 [Actor costs](docs/reference.md#actor-costs)。</sub>

- **本机直连** — [运行一条 npx 命令 →](#安装与快速开始)
- **公共 Actor** — [在 Apify 试用 →](https://apify.com/meka.im/google-trends-for-agent)
- **自行部署** — [Fork 并部署 →](#deploy-it-yourself)

<a id="deploy-it-yourself"></a>

### 自行部署

1. [Fork 仓库](https://github.com/meka-im/google-trends-for-agent/fork)。
2. 在 Apify Console 用 **Link Git repository**（分支 `main`）创建 Actor，或在克隆目录运行 `apify push`。
3. 构建完成后，在 Settings → Server 启用 **Standby**。
4. 客户端使用 `https://<user>--<actor>.apify.actor/mcp` 并带上 Apify Token。

通过公共 Standby 端点使用远程 MCP。先在 [Apify Console → Settings → Integrations](https://console.apify.com/settings/integrations) 创建 Token：

```json
{
  "mcpServers": {
    "google-trends": {
      "url": "https://meka-im--google-trends-for-agent.apify.actor/mcp",
      "headers": { "Authorization": "Bearer <APIFY_TOKEN>" }
    }
  }
}
```

同一份开源代码服务全部三种路线；HTTP 和一次性运行细节见 [`.actor/README.md`](.actor/README.md)。

## 安装与快速开始

需要 Node.js 20+。项目不发布到 npm；首次运行时 `npx` 会从 git 检出并构建。

```sh
npx -y -p github:meka-im/google-trends-for-agent#v0.2.0 gtfa snapshot Sora --geo US --json --pretty
```

零安装的 `npx` 路径首次从 git 构建约需 30–50 秒，之后每次调用仍增加约 7 秒启动开销。频繁使用建议持久安装或运行 MCP 服务器。

持久安装（先克隆，因为 npm 全局安装 git 依赖时，`prepare` 阶段可能缺少构建所需的 devDependencies）：

```sh
git clone --branch v0.2.0 --depth 1 https://github.com/meka-im/google-trends-for-agent.git && cd google-trends-for-agent && npm install && npm install -g .
```

CLI 命令是 `gtfa`，MCP 服务器由 `gtfa-mcp` 启动。本地 stdio 配置：

```json
{
  "mcpServers": { "google-trends": { "command": "npx", "args": ["-y", "-p", "github:meka-im/google-trends-for-agent#v0.2.0", "gtfa-mcp"] } }
}
```

本地 **Streamable HTTP** 端点（仅绑定 `127.0.0.1`）：

```sh
npx -y -p github:meka-im/google-trends-for-agent#v0.2.0 gtfa-mcp --http --port 4321   # http://127.0.0.1:4321/mcp
```

## dsh 插件

```sh
dsh plugin --profile web add github:meka-im/google-trends-for-agent
```

首次运行会打印 key 并失败。将 pnpm 打印的完整 key（以 commit hash 结尾）复制到 `~/.dsh/profiles/web/pnpm-workspace.yaml`，然后重跑：

```yaml
allowBuilds:
  "google-trends-for-agent@https://codeload.github.com/meka-im/google-trends-for-agent/tar.gz/<commit>": true
```

pnpm 的报错建议使用 `onlyBuiltDependencies:` 列表；dsh profile 应使用带 `: true` 的 `allowBuilds:` map（在 `allowBuilds` 下写列表会失败）。main 更新后 key 会变化，需要重新添加。

安装后打开 **dsh web → Plugins → Google Trends → gtfa → Configure**，再进入 **连接 → 出口**，选择 **本机直连**、**公共 Actor（meka.im）** 或 **我自己的 Actor**。该 bundle 把四个工具注册为进程内原生工具，并附带 `gtfa` skill；Token 保存、用量卡片和测试连接的细节见 [dsh 插件参考](docs/reference.md#dsh-plugin)。

## 词条图库

<table>
  <tr><th align="center">已成熟词</th><th align="center">新词与上升词</th></tr>
  <tr>
    <td align="center"><img src="docs/assets/traffic-notion-us-7d.svg" alt="notion 美国 7 天每日搜索量图：峰值 45.9k，最新 30.3k" width="400"><br><sub><b>notion</b> · 峰值 45.9k · 最新 30.3k 次搜索/天</sub></td><td align="center"><img src="docs/assets/traffic-gemini-4-carbon-us-7d.svg" alt="gemini 4 carbon 美国 7 天每日搜索量图：峰值 18.0k，最新 7.7k" width="400"><br><sub><b>gemini 4 carbon</b> · 峰值 18.0k · 最新 7.7k 次搜索/天</sub></td>
  </tr>
</table>
<p align="center"><sub>更多图表：<a href="docs/assets/traffic-midjourney-us-7d.svg">midjourney</a> · <a href="docs/assets/traffic-genie-4-us-7d.svg">genie 4</a> · <a href="docs/assets/traffic-perplexity-us-7d.svg">perplexity</a> · <a href="docs/assets/traffic-pika-h3-us-7d.svg">pika h3</a>。估算以 <code>gpts</code> 锚点 ≈ 3,500 次搜索/天校准；美国、近 7 天，标签使用 UTC，抓取于 2026-11-12 UTC。</sub></p>

## MCP 工具

| 工具 | 用途 |
| --- | --- |
| `trends_ask` | 兴趣、热门/上升查询、地区，可选 verdict 和 diff。 |
| `trends_snapshot` | 校准后的每日搜索量、锚点/流量块、verdict、`chart7d` / `traffic7d`。 |
| `trends_compare` | 1–5 个不同关键词在同一共享尺度上的相对 0–100 兴趣。 |
| `trends_now` | 按国家/地区获取 Trending Now，含排名、增长、分类和链接。 |

输入、时间窗、默认值和信封字段见[参考文档](docs/reference.md)和 [MCP 字段指南](docs/mcp-api.md)。

## CLI

| 命令 | 用途 |
| --- | --- |
| `gtfa ask <term>` | 单个词，可选 `--validate`、`--diff`、`--points` 和批量 `--from`。 |
| `gtfa snapshot <term>` | 校准流量、相关查询、verdict 和 SVG 图表。 |
| `gtfa compare <kw> [<kw> ...]` | 1–5 个不同关键词的相对兴趣（也支持 `--query` 模式）。 |
| `gtfa now --geo US` | 按国家/地区获取 Trending Now；`--hours` 是 Now 窗口。 |
| `gtfa doctor` | 检查 Node、Google Trends 可达性、代理，并执行一次 `gpts` 美国 24 小时抓取；`--json` 供机器读取。 |

完整选项和示例见[参考文档](docs/reference.md#cli-surface)。

## 数字如何计算

`snapshot` 和 `ask --validate` 把词条与锚点放在同一个 0–100 尺度上，再按 `traffic = round(score ÷ anchorLevel × dailySearches)` 计算。这些是基于锚点的估算，不是 Google 实测搜索量；没有可用校准或锚点未通过可靠性门槛时，流量为 `null`。

| 窗口 | 锚点 | 美国基线 |
| --- | --- | --- |
| `now 1-H` · `now 4-H` · `now 1-d` | `sudoku` | **63,000/天**，±50% |
| `now 7-d`、`today 1-m`、`today 3-m`、`today 12-m`、`today 5-y`、`all` | `gpts` | **3,500/天**，±50% |

推导过程、锚点覆盖、基线文件和 null 流量规则见[校准与锚点](docs/reference.md#calibration-and-the-anchor)。

## 文档

[参考文档](docs/reference.md) · [MCP 字段指南（中文）](docs/mcp-api.md) · [架构图](docs/assets/architecture.svg) · [更新日志](CHANGELOG.md) · [基线](examples/baselines.json)

## 开发

测试使用本地 fixture 和 mock transport，不会调用 Google。

```sh
npm install
npm test          # 422 个测试
npm run typecheck
npm run build
npm run trends -- --help
```

## 许可证

MIT。见 [LICENSE](LICENSE)。
