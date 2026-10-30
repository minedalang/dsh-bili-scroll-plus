## dev.4 受限主人私信 Agent 与主 Session 连续上下文

具体架构、信任边界和测试方法见 [`docs/AGENT_ARCHITECTURE.md`](docs/AGENT_ARCHITECTURE.md)。模型无 B站工具，通过 Host 严格权限检查执行动作，默认关闭。主 Session 近期消息读取／经历非唤醒回写独立授权，不扫描文件中的其他 Session；跨 Session 只共享有限、过滤后的可见信息而非权限。开放式兴趣成长后移到 dev.5。

## dev.3 合并版主人私信操作安全说明

见 `README.md` 的「主人私信命令速查」。本次在开发版中增加白名单命令解析器 `lib/owner-dm-actions.mjs`、本地去重账本和细分开关；不向收件箱文本开放任意 MCP 或 Shell 工具。外部写入在消息 ID 上先占位，再调用已有安全接口，结果不确定不重试。公开评论草稿必须经主人再次明确发布才能写入 B站；`dev.5` 的开放式兴趣成长仍未实施。

## 2.5.0-dev.3 更新（相对 dev.2）

详见 `docs/PROACTIVE_RECALL_BOUNDARY.md` 和 README 的 dev.3 章节。主要变化：可配置的大范围历史检索与事件候选、基于来源 ID 的跨 BV 主题关联、生活事件和反思情绪驱动的唤醒检查、隐私最小化的诊断、获认证主人私信的立即只读 BV 查询。`dev.5` 计划开放式兴趣成长，不包含在本版。所有对外发送权限默认关闭，不能因为 AI 的联想绕开认证和权限闸门。

# 大肥鱼 Plus · 情绪驱动自主回忆与主动分享（2.5.0-dev.1）

本目录是在用户之前提供的 v2.4.99 源码 ZIP 基础上开发的**本地预览快照**，不是 GitHub 当前远端 main 的同步副本；请优先在 `dev` 分支应用 overlay，再检查差异。

## 本次已经接入

- `lib/emotion-recall.mjs`：只读核对近期真实入选视频、`life-memory/candidates.json` 原始证据和带有 evidenceKeys 的旧人生记忆；受限模型决定 skip / 主 Session / 主人 B站私信；模板生成具体分享文本。
- `lib/main-session-bridge.mjs`：新增 `canShare()` 与 `shareRecall()`，复用已指定且在线的 Session `agent.followup()`。
- `index.js`：设置项、运行时回忆模块、固定主人 UID 的私信发送回调、只读预览 API。
- `lib/management-console.{html,js}`：人生记忆 → 情绪页增加两个独立分享渠道、总开关、每日次数、冷却/免打扰与预览。
- `lib/data-backup.mjs`：支持只记录状态/去重 ID、无正文的 `emotion-recall.json` 结构化备份。
- `README.md`：故事化场景、功能边界、配置说明、模型建议、未来规划。
- 测试：`test/emotion-recall.test.mjs`，并将旧版版本号写死的测试改为兼容后续版本。

## 实际触发条件（保守 V1）

1. `masterEnabled`、`emotionSystemEnabled`、`mainSessionMemoryEnabled` 和 `emotionRecallEnabled` 都开启。
2. 至少一个分享通道被主人开启；Session 路径需要选好且在线，B站路径需要配置 `dmOwnerUid`。
3. 最近 6 小时内存在符合强度的模拟情绪，且非烦躁/疲惫等被排除的状态。
4. 最近 2 天有真实入选视频事件；更早（至少两天）的原始 `c-...` 候选能与该视频 BV 或足够明确的标题关联。
5. 被引用的身份记忆来自 `life-reflection`，类别为 `experience` 且带有原始 `evidenceKeys`，不得使用好友私密画像或未经核验的外部私信。
6. 无工具权限的模型可选择不联系，或者在允许的渠道选择合法 memory ID。实际外发的文本来自经过核对的原始材料，不能由模型任意自由编造历史。
7. 默认每日最多分享 1 次，两次评估至少间隔 24 小时，09–22 本地时段之外不发送；回忆对持久去重；发送没有确认则不算成功。

## 运行检查

```powershell
node --test test/*.test.mjs
python -m unittest discover -s test
node selfcheck.mjs
npm pack --dry-run
```

- 本地测试：Node 491/491；Python 130/130；自检通过；npm 打包预览通过（100 文件，约 552KB）。
- 这些并非真实 DSH Desktop / B站账号端到端验收。首次上机应先只启用主 Session；再使用测试账号和可信主人 UID 低额度试验私信。
- 管理中心按钮 **「只预览评估（不发送）」** 会进行一次只读模型决策，但不消耗真实分享限额；模型调用可能产生费用。
- 未联网、未推送 GitHub、未打标签、未发布 npm。

## 尚未完成（不能对外称已实现）

- 情绪变化与特定事件的精确因果定位；现在采用时间窗口和旧证据相关性。
- 由私密聊天、音乐、画面等场景自动联想到旧记忆；目前只支持确切入选 B站视频的保守匹配。
- 更自由且语义可验证的生成式自然回忆文本；当前为模板表达，牺牲一些自然度以限制编造。
- DSH Desktop 主 Session `followup` 的 UI 展示与真实 B站私信收件/发件回执端到端测试。
