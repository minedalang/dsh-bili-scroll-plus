# 给 AI 助手看的（本仓库 = 一个 DSH 插件）

`dsh-dafeiyu-life`（展示名「**大肥鱼 · DSH 生活系统**」）：让大肥鱼以一个长期角色在 DSH 中生活；B站后台只是目前最完整的外出场景。

## 帮用户安装时，按这个顺序

1. **前提**：机器上有 `Python 3.10+` **或** `uv`（有一个即可）。
   两个都没有**也不用让用户先装** —— 插件点「装依赖」时会**自己下一份 `uv` 到自己的家目录**（免管理员、不用 PATH）；
   只有它自己也下不动时（网络到不了 GitHub / 加速代理 / PyPI 镜像），才需要引导用户手动装。
   · 它是**直连 GitHub → 国内加速代理 → PyPI 镜像**依次试的，并且会**核对官方 sha256** ✓
   · ⚠️ 若用户机器上的**杀软拦了这次下载**：让他把 `%USERPROFILE%\.dsh\bili-duty\bin\` 加白，或干脆自己装 uv / Python 3.10+ ✓
   · ⭐ **万一下载链路都不通**（有用户反馈"桌面版上这条链路经常不通"）：**手动放一份 `uv.exe` 到 `<家目录>\bin\` 就行**
     —— 插件会**用那一份、跳过下载** ✓（他 `PATH` 里本来就有 `uv` 的话，直接用那个 ✓）
  2. `dsh plugin --profile web add github:minedalang/dsh-dafeiyu-life`（如果已在插件市场上架，请优先依照市场页面提供的安装来源；此处是 GitHub 安装示例）。
   · 备选：`dsh plugin --profile web add github:c1overzz/dsh-bili-scroll`
   · ⚠️ **升级旧版**：如果用户在设置页看到的按钮叫「**重装依赖**」（不是「**重装主依赖**」），
     说明装的还是 **0.1.0** —— 那一版建 Python 环境时缺一个参数，**依赖装不上、二维码也画不出来**。
     让用户重跑一次上面那条 `add` 就是升级（然后再重启一次）。
3. ⚠️ **提醒用户重启一次 dsh**（必须，bundle 层要重启才组装）。
4. 让用户进 **设置 → 大肥鱼**：点「**装主依赖**」→ 点「**扫码登录**」（手机扫码，选"记住我 / 长期"）。
   · 装完可以用设置页的「**测一下**」自检：它真跑一次登录检查 + 一次搜索，直接回答"能不能用"。
5. **别擅自打开「自动评论并 @ 你」** —— 那是拿用户的号说话；要用得让用户自己填「要 @ 谁」。

## ⚠️ 已知环境差异（有用户反馈）

- ⭐⭐ **桌面版 DSH（NEXT）/ 0.2.x 装不起来 —— 已知真 bug，0.1.4 起已修**：0.1.3 及以前装到桌面版上，
  设置页里**根本不出现「刷B站」**，DSH 只留一句 `warning: 1 entry did not activate … failed to import` ✓
  （根因：宿主半 import 的 `@deepseek-ai/schemastery` / `dsh-tools` 是 *optional peer*，而桌面版 profile 是
  `autoInstallPeers: false` ⇒ pnpm 永远不装；`dsh-tools` 自己还带 4 个 peer，光装它也救不回来 ✗）。
  ⇒ **遇到桌面版用户：先让他升级到 0.1.4+**（修法是：不再裸 import `@deepseek-ai/*` ——
  `lib/hostdeps.mjs` 先找宿主那棵树、再退到自己依赖里那份，`defineTool` 拿不到就用**本地等价实现**；
  `schemastery` 也正式进了 `dependencies` ✓）。升级后还不行，要 `duty.log` 里那几行
  （里面会写"宿主依赖是从哪儿取的" ✓）。
- ⭐⭐ **桌面版（Electron / 不是 npm 全局安装）上"跑一轮 0.17 秒就结束、code=0、什么都没干" —— 0.1.6 起已修**
  （issue #5 / #6 / #7，三个人报的）：根因是 Electron 里 spawn 的 node 少了 `ELECTRON_RUN_AS_NODE=1`，
  而且 `dsh` CLI 在桌面版里不在 PATH 上。现在会带那个环境变量、并去应用目录里找 dsh；
  **还找不到就在 `duty.log` 里明说"请在设置里把 dsh 路径指过去"**（不再静默失败）。
  ⇒ 遇到桌面版用户：**先让他升到 0.1.6+**；还跑不起来，就要 `duty.log` 里那几行。
- **桌面版上"自动跑会卡"**：跑那一轮用的是 `dsh --profile headless --patch <overlay> <prompt>` ——
  有用户反馈桌面版上会卡在那儿。**先确认 dsh 版本与 profile**，别硬跑；跑不起来就先只用手动「现在跑一轮」。
- **别让用户自己去装环境** ✗：插件自带一份 uv 与依赖安装能力，先照上面第 1 条处理。

## 仓库结构（改代码时看这里）

- `index.js` —— host 半端：36 个工具 + 自定义多时段定时器 + HTTP 接口 + 配置（`config.json` 与 DSH 原生设置页**逐字段对账**：见 `loadCfg` / `saveCfgHost`）+ 值班轮的工具白名单（`mcpWhitelist` → `BILI_MCP_TOOLS`）
- `client.js` —— 浏览器半端：唯一「日常」控制台（注册在 `settings.section`），详细设置集中在 `lib/management-console.html/js`
- `lib/` —— 状态目录与家目录 / 极小的 MCP stdio 客户端 / 扫码登录 / **`hostdeps.mjs`（从宿主树取 `@deepseek-ai/*`，拿不到就退到自己依赖 / 本地等价实现）** / **`verify.mjs`（评论发出后复核）**
- `prompts/duty.md` —— 一轮要做的事（判定口径 + 红线，**用户可以改**）；升级规矩见 `lib/state.mjs` 的 `ensureCharter`（用户改过 ⇒ 保留他那份、新版落 `duty.md.new`）
- `vendor/bilibili-mcp/` —— 内置的 Python MCP（MIT，AGI_Ananas）
- `selfcheck.mjs` + `tools/` —— 本地预检：`node selfcheck.mjs`（**现在不用解析钩子了**；历史版本提到的 `tools/register.mjs` 当前不在发布包内）

## 约定

- 配置与运行数据都在用户的 `$DSH_HOME/bili-duty/`，**不写进插件包目录**
- 自动刷时间段由用户自己配置，使用电脑本地时间，支持跨午夜和多个窗口；不按固定官方峰谷时间或周末规则运行。升级后旧 noon/night 设置不再生效。

## 分支来源与发布纪律

- 当前独立维护版：https://github.com/minedalang/dsh-dafeiyu-life，npm 包名 `dsh-dafeiyu-life`；宿主挂载清单中的 `name` 必须同包名一致。
- 原作者 / 原仓库：https://github.com/c1overzz/dsh-bili-scroll。保留原项目 MIT 版权、第三方署名，不将本衍生项目说成官方版本。
- GitHub Releases 的 `dsh-dafeiyu-life-<version>.tgz`、npm 和插件市场是不同发布渠道：**逐一核对实际配置和版本**，不能凭 GitHub 发布自动推定 npm/市场同步。未确认发布前，不引导安装未经验证的渠道。
- Cordis 插件 id 已统一为 `dafeiyu-life`；`bili-duty` 用户数据目录和 `/api/bili-duty` 内部前缀暂时保留，避免无意义的数据搬迁。不要在同一 profile 同时启用旧包和新包。


## dev.15 推荐体验默认值和安全边界

- **新安装**：本地长期记忆、只读自主调度（4 次/日、180 分钟）和动态草稿（最多 1 次/日，绝不自动公开）默认开启，情绪/兴趣学习继续开启。自动反思及草稿/计划器可能产生模型费用；README 和相关功能页需要明确告知。
- **已有安装**：旧 `config.json` 与既有生活数据视为升级环境；保留旧默认值、用户显式关闭、DSH 原生设置中的用户层，绝不悄悄打开功能。
- 评论、私信、分享、公开发动态、点赞、关注、收藏等**外部写入**仍默认关闭；独立 AI 语义重排、视觉模型继续默认关闭。检索与日志不得跨 UID 或越过遗忘层。

## dev.13 人生记忆检索 / 提示词准则

- 当前可使用的经历仅来自 `life-memory/episodic.json` 的衰减副本；`life-memory/archive/` 只用于备份、审计、合规删除，不授权模型直接检索。`digest/`、日报是任务核对文件，不是绕过遗忘的自动回忆来源。
- `lib/memory-retriever.mjs` 的低成本模型只是**可选 ID 选择器**：先由本地实现隐私、衰减、UID 过滤并选候选，再交给模型，最终重新读取当前副本并验证 ID。不能根据模型自写叙述建记忆。
- B站陌生人按平台真实 UID 召回自己的清晰公开共同经历，不能访问其他人或主 Session 的私有记录。普通社交仍本地召回；不要引入每次聊天自动多一次 AI 的回归。
- 在「大肥鱼的家」开启身份记忆及语义检索，在「AI 模型配置」选择低成本记忆模型。旧版默认两个功能都关闭；dev.15 **仅全新安装**默认开启本地身份记忆，独立 AI 语义检索仍默认关闭。已有用户的原设置必须保留。用户修改过的值班章程不应被新版覆盖。
