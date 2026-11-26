<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/logo-light.svg">
    <img alt="google-trends-for-agent" src="docs/assets/logo-light.svg" width="420">
  </picture>
</p>

<p align="center"><b>面向 AI Agent 的搜索兴趣信号。一次调用，输出稳定 JSON。</b></p>

<p align="center"><a href="README.md">English</a> | 简体中文</p>

<p align="center"><a href="https://www.npmjs.com/package/google-trends-for-agent"><img src="https://img.shields.io/npm/v/google-trends-for-agent?style=flat-square&logo=npm&logoColor=white&color=CB3837" alt="npm version"></a> <a href="https://apify.com/meka.im/google-trends-for-agent"><img src="https://img.shields.io/badge/Apify%20Store-google--trends--for--agent-97D700?style=flat-square" alt="Apify Store"></a> <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="MIT license"></a> <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square&logo=node.js&logoColor=white" alt="Node.js >= 20"></a> <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript strict"> <img src="https://img.shields.io/badge/status-unofficial-orange?style=flat-square" alt="Unofficial"></p>

<p align="center"><a href="https://apify.com/meka.im/google-trends-for-agent"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/store-button-zh-dark.png"><img src="docs/assets/store-button-zh.png" alt="在 Apify Store 打开" width="224" height="44"></picture></a></p>

> [!WARNING]
> **非官方项目，与 Google 无隶属关系，也未获其背书。** 本项目调用未公开的 Google Trends Web 接口，这些接口可能随时变更或失效，使用方式也可能与 Google 服务条款冲突。请仅用于轻量、交互式分析，不要用于批量抓取，也不要将其视为 SLA。

`google-trends-for-agent` 让 Agent 和人类以可预测的方式查询搜索兴趣变化：稳定的 JSON 信封、校准后的每日搜索量估算、图表，以及明确的错误码，而不是编造数字。

<p align="center">
  <img src="docs/assets/demo-terminal.svg" alt="动画演示 gtfa snapshot 命令逐字显示，并逐行返回 Sora 的裁剪 JSON 信封" width="800">
</p>
<p align="center"><sub>真实快照输出，已裁剪。完整信封还包含序列、主窗口与近 7 天流量块、相关查询上下文、警告和元数据。</sub></p>

## 按客户端选择安装教程

**AI Agent 请先打开[客户端接入总入口](docs/clients.md)，按自身所在宿主直接跳转到对应教程后再配置或调用。**

- [DeepSeek Harness (dsh)](docs/clients/dsh.md) · [GrokBot](docs/clients/grokbot.md) · [Muse](docs/clients/muse.md) · [Dots 与网页 Agent](docs/clients/dots.md)
- [Claude Code 与 Desktop](docs/clients/claude.md) · [OpenAI Codex](docs/clients/codex.md) · [Cursor / VS Code / Windsurf / Cline](docs/clients/cursor-vscode.md) · [OpenClaw 与本地 CLI](docs/clients/openclaw.md)

**Muse、GrokBot、Dots 统一优先使用 Apify 按需运行**，可选公共 Actor 或自己部署的
Actor。支持远程 MCP 时接入官方托管入口；否则使用客户端已有的 Apify 连接器/API。
本机直连继续用于开发或用户明确选择的场景。

| 路线 | 执行位置 | 运行方式 |
| --- | --- | --- |
| 公共 Actor | 你的 Apify 账号 | 有查询才启动，完成即退出，无需部署 |
| 自己的 Actor | 你的 Apify 账号 | 部署一次，随后按次运行 |
| 本机直连 | 本机 | CLI、stdio MCP 或 dsh 原生工具 |

<a id="deploy-it-yourself"></a>

### 自行部署

Fork 仓库，在 Apify Console 用 Link Git repository 构建，或运行 `apify push`。保持 Server / Standby 关闭。dsh 中选择“我自己的 Actor”，登录 Apify，再选择已构建的 Actor。

已从官方 main 部署的 Actor，可在 dsh 点击**更新选中的 Actor**。构建完成后，**测试连接**分别显示关键词取数与 Actor/插件的实际版本。自定义或固定版本源码请在 Apify Console 更新。详见[发布与验收清单](docs/releasing.md)。

### 远程 MCP

Muse、GrokBot、Dots 支持远程 MCP 时，使用 Apify 官方托管入口，在客户端内完成 OAuth 登录：

```json
{
  "mcpServers": {
    "google-trends": {
      "url": "https://mcp.apify.com?tools=meka.im/google-trends-for-agent"
    }
  }
}
```

使用自建 Actor 时，把 `tools=` 后的 `meka.im/google-trends-for-agent` 替换为自己账号的
`<username>/<actor-name>`；登录账号需要有该 Actor 的访问权限。

该入口将本项目暴露为 Actor 工具，按次启动运行，并提供读取 Dataset、读取 key-value store 和停止运行的工具。它不承诺四个 `trends_*` 同名工具；本机 MCP 和 dsh 原生插件提供四个 `trends_*` 工具。通过官方入口调用普通 `tool` / `terms` 输入后，用返回的 Dataset id 读取结果。

Apify OAuth 的 `full_api_access` 是完整账号 API 权限。没有 MCP OAuth 的客户端可通过安全凭据配置 Bearer header。费用与边界见 [Actor 参考](.actor/README.md) 和 [Actor costs](docs/reference.md#actor-costs)。

## 安装与快速开始

CLI 与 MCP 服务器已发布至 npm（包名 [`google-trends-for-agent`](https://www.npmjs.com/package/google-trends-for-agent)），需要 Node.js 20+。可直接通过 `npx` 运行：

```sh
npx -y -p google-trends-for-agent gtfa snapshot Sora --geo US --json --pretty
```

频繁使用建议直接从 npm 全局安装：

```sh
npm install -g google-trends-for-agent
```

也可以从源码仓库自行构建安装：

```sh
git clone https://github.com/meka-im/google-trends-for-agent.git
cd google-trends-for-agent
npm ci
npm install -g "$(npm pack | tail -1)"
```

源码 clone 默认跟随仓库的 `main` 分支。如果审查流程需要不可变源码版本，请固定 npm 版本号或 git commit，不要依赖移动的分支。

发布的 tarball 会内置经审计的 `apify` 依赖树，避免 consumer 重新解析较旧的 Apify 漏洞传递依赖。根 npm `overrides` 不会传播给 consumer，因此内置依赖树是 consumer 防护的一部分。根包还显式将 `@crawlee/core` 的 `minimatch` 覆盖为 `^11.0.1`（lock 为 `11.0.8`）；Crawlee 声明的是 `^9`，因此 consumer 的 `npm ls` 可能显示范围警告，但这是有意设置的安全 override。审计同时覆盖根依赖树和打包产物在干净 consumer 中的安装；内置依赖会使包体积明显增大。

CLI 命令是 `gtfa`，本地 MCP 服务器由 `gtfa-mcp` 启动。两者默认走 `local` 本机网络，也支持 Apify 按需云端出口（`--egress actor-public` 或 `--egress actor-own --actor <id>`，或通过环境变量 `GTFA_EGRESS` / `GTFA_APIFY_ACTOR` 配合 `APIFY_TOKEN`），可在直接暴露四个 `trends_*` 工具的同时走 Apify 住宅代理。若客户端支持免本地进程的远程托管 MCP，Muse、GrokBot、Dots 优先按[Apify 接入指南](docs/clients.md)配置：

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["-y", "-p", "google-trends-for-agent", "gtfa-mcp"]
    }
  }
}
```

需要本地 stdio MCP 直接走 Apify 公共 Actor 时（将 `APIFY_TOKEN` 放在客户端安全环境变量中）：

```json
{
  "mcpServers": {
    "google-trends": {
      "command": "npx",
      "args": ["-y", "-p", "google-trends-for-agent", "gtfa-mcp", "--egress", "actor-public"],
      "env": { "APIFY_TOKEN": "<your-apify-token>" }
    }
  }
}
```

全局安装（`npm install -g google-trends-for-agent`）后可直接使用下面的配置（或 `gtfa-mcp` 的绝对路径），无需每次启动都由 `npx` 解析：

```json
{
  "mcpServers": { "google-trends": { "command": "gtfa-mcp", "args": [] } }
}
```

本地 **Streamable HTTP** 端点（仅绑定 `127.0.0.1`）：

```sh
npx -y -p google-trends-for-agent gtfa-mcp --http --port 4321   # http://127.0.0.1:4321/mcp
```

检查包下载和数据抓取两段连通性：

```sh
curl -I https://registry.npmjs.org
curl -I https://trends.google.com
```

若 `npx …` 非零退出且 stdout/stderr 为空，说明 gtfa 启动前 npm 包获取失败；查看 npm debug 日志（通常在 `~/.npm/_logs/`）。**MCP 无法启动**表现为 npx/npm 错误、握手前 EOF；**MCP 已启动但工具取数失败**则握手和 `tools/list` 成功，工具返回 `NETWORK_ERROR`、`RATE_LIMITED` 等上游错误。后者可用 `gtfa doctor --json` 排查。

## dsh 插件

<p align="center">
  <img src="docs/assets/demo-dsh-install-zh.svg" alt="DeepSeek Harness Mac 客户端安装 google-trends-for-agent 插件动画演示" width="800">
</p>
<p align="center"><sub>DeepSeek Harness (Mac)：打开<b>插件 → + 安装插件</b>，直接输入 npm 包名 <code>google-trends-for-agent</code>（不要填 npmjs.com 网址），安装完成后重启客户端即可加载后端。</sub></p>

- **DeepSeek Harness Mac 桌面端**：打开**插件 → + 安装插件**，在输入框中直接填写 npm 包名 **`google-trends-for-agent`**（不要粘贴 `npmjs.com/package/...` 网页链接）一键安装，无需手动修改 `allowBuilds`。
- **dsh CLI（`dsh web`）**：需要 **Node >=24.9** 且 **pnpm >=10** 在 `PATH` 中（`npm i -g @deepseek-ai/dsh pnpm@10`；仅用 `gtfa` CLI/MCP 时只需 Node 20+）：

```sh
dsh plugin --profile web add google-trends-for-agent
```

安装或升级插件后，请完全退出并重新打开 dsh，以加载插件后端。插件设置保存后立即生效。

<details>
<summary>备选：从 GitHub <code>main</code> 安装未发包源码</summary>

如需直接测试 `main` 分支最新未发版提交，可改为从 GitHub 安装：

```sh
dsh plugin --profile web add github:meka-im/google-trends-for-agent
```

首次运行通常会打印构建批准 key 并失败（若 pnpm store 已缓存可能直接成功）。将 pnpm 打印的完整 key（以 commit hash 结尾）以 `allowBuilds:` map 格式追加到 `$DSH_HOME/profiles/web/pnpm-workspace.yaml`（`DSH_HOME` 默认为 `~/.dsh`），保留已有键并重跑命令：

```yaml
allowBuilds:
  "google-trends-for-agent@https://codeload.github.com/meka-im/google-trends-for-agent/tar.gz/<commit>": true
```

请使用带 `: true` 的 `allowBuilds:` map（不要写成列表）；`main` 前进后 key 会变化，更新后需重新添加。

</details>

插件安装后默认启用，提供四个原生工具和 `gtfa` skill。在 dsh 0.2.2-rc.1 中，打开 **dsh web → Plugins → Google Trends** 已安装插件卡片，在详情页 **Components** 下点击 **Google Trends / gtfa** 行进入设置页。在 **Connection（连接方式）** 区块选择 **本机直连**、**公共 Actor** 或 **我自己的 Actor**，再点 **Save（保存）** 应用 egress；登录本身不需要 Save。Host 提供 credentials service 时，两条 Actor 路线都提供 **Sign in with Apify（登录 Apify）**：页面显示 Apify 官方授权链接和 user code；pending 时每 2 秒查询一次状态并遵守 Apify 的 polling interval（包括 `slow_down`），关闭页面暂停、重新打开继续，过期后重新发起。Apify 当前的 device OAuth scope 只有 `full_api_access`——这是完整 Apify API 访问权限，不是仅限本 Actor 或本工具的权限。

每次操作都会重新解析凭据：优先使用已存储的 OAuth session；只有在没有存储 session 时才使用已保存 config token，再回退到 `APIFY_TOKEN`。已存储的 session 若过期或损坏且无法 refresh，必须重新登录，不能静默回退或当作成功。OAuth 凭据不会进入浏览器可见状态，也不会进入模型可见的 tool input/output；Host 内部代码通过 credentials service 解析后调用 Apify。Host 没有该服务时，OAuth 不可用，但本机 egress、手动 token 和 `APIFY_TOKEN` 仍可使用。对 dsh device flow，当前 access token 是长效 token，不签发 refresh token；若 Apify 未来返回标准过期/刷新响应，插件可兼容处理。

设置页采用三张出口卡片，下方集中显示 OAuth 状态和用量；展开**用量详情**可查看计费周期及代理用量。**高级**内分为**校准基线**、**手动 Token**（仅 Actor 出口）和**文件与图表**。**保存更改**与**还原**悬浮于页面底部；**测试连接**直接使用当前连接，包括尚未保存的 Actor 和手动 Token，不会保存设置。退出登录位于连接检查旁的账号菜单内。界面跟随 Host 的深浅主题，并适配窄屏。

持久化交给 dsh credentials service/provider-managed store，与 profile 分离；后端位置、记录键和 schema 可以不同。当前本地 file-backed provider 在适用时使用 owner-only `0700` 目录与 `0600` 文件权限；它不是 OS Keychain，也不是加密存储，不能阻止同一 OS 用户下的其他进程读取。手动 token 位于**高级 / 备用**区域，仍会明文写入 `cordis.patch.yml`（mode `0600`），UI 中隐藏，不会记录，也不会进入浏览器可见状态或模型可见的 tool input/output。**Cancel（取消）** 只取消 pending flow。**Sign out（注销）** 删除已存储的 OAuth session，但按 provider 后端保留可复用的 client registration；它**不会撤销 Apify 云端授权**，如需撤销请到 Apify Console。路由和生命周期细节见 [dsh 插件参考](docs/reference.md#dsh-plugin)。

从 dsh 侧边栏（或「更多」）打开 **Google Trends**，可使用「查询、记录」两页。单词快照和多词对比默认使用 **近 7 天（`now 7-d`）**，共用九种时间范围（从过去 1 小时到全部时间）。「插件设置」打开已有的已安装插件页面；对话仍使用原来的四个原生工具。

查询统一输入 1–5 个关键词，用逗号分隔并自动选择工具。多词使用同一批数据、一次按需 Actor 运行，有空位时把校准锚点一并带上。当前适配器使用 Classic Explore 的五项对比接口；Google 的[新版 Explore 页面支持更多对比组](https://support.google.com/trends/answer/4359550?hl=en)。5 个关键词占满当前适配器的本批对比项，此时需其中已有本地区的已知锚点，才能同批估算搜索量；没有可用校准时如实留空。页面显示实际运行阶段和已用时间；切到其他 dsh 页面后，草稿、进行中的请求和结果都会保留。点击「取消」可停止请求；关闭或刷新浏览器、卸载插件会取消请求。

Host 将最近 1,000 次手动和 Agent 调用（包含失败及结果副本）保存在 `<snapshotDir>/.query-history`。回看和刷新记录不会重新查询。可确认清理单条、所选或全部记录，统计随之变化；查询缓存、Apify 运行和账单独立保留。Actor 费用只展示关联运行实际返回的金额，缺失时保持未知。打开页面不会启动 Actor，也不会在后台持续取数。

相对 `snapshotDir` / `chartDir` 路径以启动 `dsh web` 的目录（cwd）为基准；图表默认写入 `<cwd>/.gtfa/charts/`。

**测试连接**会先检查网络和认证，再合并查询 ChatGPT、Gemini、weather（美国，近 24 小时），逐个显示数据点数量，并支持取消。Actor 模式在基础检查通过后启动一次按量计费的运行，完成即退出；遇到验证码或限流立即停止，不自动重试。

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
| `trends_ask` | 兴趣、热门/上升查询、地区，可选 verdict 和 diff（默认 `US`、`now 7-d`）。 |
| `trends_snapshot` | 基于 MEKA 多档位自动校准的每日搜索量（首轮超量程时自动换锚二轮重试）、锚点/流量/`calibration` 块、verdict、`chart7d` / `traffic7d`。 |
| `trends_compare` | 1–5 个不同关键词在同一共享尺度上的相对 0–100 兴趣；可选 `calibrate: true` 附带多档位 `batchVolume` 批量估算。 |
| `trends_now` | 按国家/地区获取 Trending Now，含排名、增长、分类和链接。 |

输入、时间窗、默认值和信封字段见[参考文档](docs/reference.md)和 [MCP 字段指南](docs/mcp-api.md)。

## CLI

| 命令 | 用途 |
| --- | --- |
| `gtfa ask <term>` | 单个词（默认 `US`、`now 7-d`），可选 `--validate`、`--diff`、`--points`、批量 `--from`、`--egress`、单次请求 `--timeout MS` 和 `--pretty`。 |
| `gtfa snapshot <term>` | 多档位校准流量、相关查询、verdict、SVG 图表、`--egress` 与单次请求 `--timeout MS`。 |
| `gtfa compare <kw> [<kw> ...]` | 1–5 个不同关键词的相对兴趣（也支持 `--query` 模式），可选 `--calibrate` 附带 `batchVolume` 及 `--egress`。 |
| `gtfa now --geo US` | 按国家/地区获取 Trending Now；`--hours` 是 Now 窗口；支持 `--egress`。 |
| `gtfa baselines [--sync]` | 查看当前生效的 MEKA 校准基线状态，或手动从 `meka.im` 同步最新基线。 |
| `gtfa doctor` | 检查 Node、Google Trends 可达性、代理，并执行一次 `gpts` 美国 24 小时抓取。`--timeout MS` 限制每项网络检查；遇到 challenge 或 HTTP 429 时不再执行 live fetch。`--json` 供机器读取。 |

完整选项和示例见[参考文档](docs/reference.md#cli-surface)。

`gtfa ask --pretty` 会缩进普通 ask、validation batch、diff 和错误 JSON，而 `ask --validate` 未传 `--json` 时仍输出表格；`--timeout MS` 作用于每个 Explore 请求，不是整次调用的总时限，慢速 VM 可显式提高到 60000。

## 数字如何计算

`snapshot`、`ask --validate` 与 `compare --calibrate` 把词条与 MEKA 地区锚点放在同一个 0–100 尺度上，再按 `traffic = round(score ÷ anchorLevel × dailySearches)` 计算。这些是基于锚点的估算，不是 Google 实测搜索量；没有可用校准或锚点未通过可靠性门槛时，流量为 `null`。

全端（Library API、CLI、MCP、Apify Actor 与 dsh 插件）统一使用同一套 **MEKA v1 校准基线**（59 个 Google Ads Keyword Planner 锚点，覆盖 7 个地区，版本 `2026-11-19`；安装/首次启动自动同步一次，之后可通过 `gtfa baselines --sync` 或 dsh 设置页手动同步）。`trends_snapshot` 在未固定锚点且首轮超出量程时，会自动执行第二轮多档位换锚重试，成功时回填更准确的 `anchor` 与 `traffic`。

标定基线（包括 version 2 文件和用户提供的锚点行）只适用于 **Web、category 0**。CLI 使用其他 property 或分类过滤时仍可返回相对兴趣，`traffic` / `traffic7d` 对象继续存在，但其中的每日搜索量字段为 `null` 并附带说明；version 2 格式没有扩展。只有 Snapshot 的 Popular/Rising 行保留 `estDaily` 以兼容公开 schema，且它始终为 `null`：相关查询榜单与主词并不共享同一兴趣标尺。Ask 的相关词表不包含 `estDaily`。

Snapshot 默认时间窗口为 `now 7-d`（直接复用主序列作为 `chart7d` / `traffic7d`，不再发第二次请求）。主窗口不是 `now 7-d` 时，主尝试结束后，只要结果不是 `BLOCKED` / `RATE_LIMITED`，就尝试一次单独的 7 天请求；普通 `NETWORK_ERROR` 等错误本身不会阻止这次尝试。请求被跳过时返回空图表、null 流量和基线元数据，同时附带 warning。调用方取消或整体 deadline 会传播到整个 snapshot，不会被转换成上述正常兜底字段。

| 地区 | 默认锚点 | 每日搜索量基线 | 档位数量 |
| --- | --- | ---: | ---: |
| 美国 (`US`) | `sudoku` | **88,000/天**，±50% | 10 个锚点 |
| 加拿大 (`CA`) | `sudoku` | **15,000/天**，±50% | 7 个锚点 |
| 英国 (`GB`) | `crossword solver` | **27,000/天**，±50% | 8 个锚点 |
| 德国 (`DE`) | `Kreuzworträtsel` | **22,000/天**，±50% | 8 个锚点 |
| 法国 (`FR`) | `sudoku` | **22,000/天**，±50% | 8 个锚点 |
| 日本 (`JP`) | `テトリス` | **18,000/天**，±50% | 8 个锚点 |
| 全球 (`""`) | `stopwatch` | **160,000/天**，±50% | 10 个锚点 |

未知地区或稀疏数据仍返回 `null`。详见[地区数值、来源与验证](docs/baselines.md)与[校准与锚点](docs/reference.md#calibration-and-the-anchor)。

## 文档

[客户端接入](docs/clients.md) · [参考文档](docs/reference.md) · [MCP 字段指南（中文）](docs/mcp-api.md) · [架构图](docs/assets/architecture.svg) · [更新日志](CHANGELOG.md) · [基线](examples/baselines.json)

## 开发

测试使用本地 fixture 和 mock transport，不会调用 Google。

CI、设置页交互和真实 Host 版本验证见[自动化检查与 dsh 兼容测试](docs/testing.md)。

```sh
npm install
npm test
npm run typecheck
npm run build
npm run trends -- --help
```

## 许可证

MIT。见 [LICENSE](LICENSE)。
