# dsh-dafeiyu-life 2.6.0-dev.2 补丁

本补丁基于用户提供的 `dsh-bili-scroll-plus-recovered.zip` 源码制作，不包含 `.git`，不会替换或覆盖你的 Git 仓库元数据。

## 修改内容

1. 「真实状态变化」改为一张五指标多色折线图：社交意愿、情绪强度、活力、好奇心、情绪正向度。
2. 删除「👥 逐渐熟悉的人」区域中的「历史兼容资料（旧版人物关系与成长记录）」界面入口和对应前端加载逻辑；不删除旧数据，不移除后端兼容能力。
3. 人生反思统计拆分为「评估后未沉淀」和「因经历已遗忘跳过」。
4. 人生反思提示词与校验错误说明更明确；失败批次仍保持待反思，不会被标记为已完成。
5. 版本号更新为 `2.6.0-dev.2`，并更新 CHANGELOG。
6. 更新相关回归测试。

## 应用方法

1. 先退出 DSH Desktop。
2. 在你的项目根目录做一次 Git commit 或备份。
3. 将本补丁 ZIP 解压到项目根目录，允许覆盖同名文件。
4. 确认没有覆盖 `.git`（本补丁不包含 `.git`）。
5. 在项目根目录运行：

```powershell
node --test
python -m unittest discover -s test -p "test_*.py"
node selfcheck.mjs
npm pack --dry-run
```

6. 所有检查通过后，使用现有的 `deploy-local.ps1` 通过本地 `.tgz` 安装；不要使用 `dsh plugin add .`。

## 本次验证

- Node.js：787/787 通过
- Python：126/126 通过
- Host / Client selfcheck：通过，36 个 Host 工具及 2 个 Client Slot
- `npm pack --dry-run`：通过，包名 `dsh-dafeiyu-life@2.6.0-dev.2`

真实 DSH Desktop 页面显示与 B 站账号端到端行为仍需在你的环境验收。
