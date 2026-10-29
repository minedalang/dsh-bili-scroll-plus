# 自然社交邀请反馈与人生记忆可视化

## 自主社交决策

- 第一层：`dual-context-agency.json` 决定 B站请求意愿，独立于主 Session 的执行逻辑。
- 第二层：`decideOwnerSocialComment` 使用受限公开视频信息和第一层的评分，选择 `comment` 或 `skip`；高评分不保证评论。
- 第三层：仅 `comment` 且内容通过安全校验、权限再次核实才允许发顶层评论。
- `skip`：按白名单原因映射固定简短回复，使用已核验通知的 `rpid` 作为回复目标。不会把视频标题、邀请原文、模型推理、私人消息拼进公开回复。

## 权限与幂等

- 跳过反馈复用主人自然社交评论授权 `ownerCommentSocialPublishEnabled`，无需开启可选的“点赞成功回执”开关。
- 仍必须满足有效主人 UID、总开关、主人评论 Agent、登录凭据、`commentDailyLimit`、`commentReplyPerDay` 和独立工具硬限制。
- 先持久记录处理和 `replyStatus=reserved` 再发出外部请求；发送结果不确定时 `uncertain`，**不自动重发**，以免重复回复。
- 没有评论权限或额度时，不尝试发送，记录 `replyStatus=blocked`。

## 数据与界面

- `owner-comment-agent.json`：`social_invite` 的 `status` 与 `replyStatus`，不保存公开回执正文。
- `dual-context-agency.json`：允许、推迟、拒绝与评分；不保存原始消息内容。
- 「人生记忆」→「情绪与心情」：真实历史轨迹，带减弱动画；自主回忆评估流程/汇总/可滚动列表。
- `no-recent-emotion` = 最近情绪没有达到回忆触发条件，不是系统故障；技术码可展开。
- 「人生记忆」的「💬 社交互动」快捷入口跳转真实独立「社交互动」页。

## 真实环境复测

1. 使用真实主人 UID 发送一条**新的** @ 自然邀请，观察意愿记录与 `owner-comment-agent.json`。
2. 如果选择 `skip`，应在原 @ 下看到简短回复、`replyStatus=sent`；没有额外顶层评论。若额度关闭，观察 `blocked`，无需继续发送真实消息。
3. 如果选择 `comment`，只允许一条经安全校验的原创顶层评论；无额外机械成功回执。
4. 同一通知重新轮询不能重复回复。对于 `uncertain`，先人工核对 B站实际评论后再处理。
5. 检查管理中心「人生记忆」中诊断列表滚动、原因解释、情绪曲线与跨页导航；按系统“减少动态效果”验证动画关闭。
