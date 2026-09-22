# Fatfish Air · 肥鱼桌宠 for JetBrains Air

面向中文用户，让肥鱼陪你在 JetBrains Air 里工作：跟随任务状态、在需要输入时催你、完成后报信，也能用自然语言聊天和做动作。

这是 [jtheller/fatfish-air](https://github.com/jtheller/fatfish-air) 的社区扩展，基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。桌宠、角色动画、设置面板、模型接入和物理交互来自原作；本目录维护 Air 联动及交互适配。与 JetBrains、OpenAI 或 DeepSeek 无官方隶属关系。

## 安装

首版支持 **Windows x64、Node.js 22+、dsh-pet 0.2.11、DSH 0.1.5-rc.1**。Air 联动使用本地日志；Codex 支持完成事件与用量，其他 Agent 目前只提供可观察到的工作/输入状态。

从 [Releases](https://github.com/jtheller/fatfish-air/releases) 下载 `fatfish-air-0.1.2-windows.zip`，解压到固定目录，按[安装与撤销](docs/INSTALL.md)操作。也可在本仓库的 `integrations/jetbrains-air` 内执行相同命令。ZIP 是扩展源码与安装工具，不是独立 EXE；原版插件和动画由固定 npm 版本安装。

当前版本 **0.1.2**：修复 Windows 窗口层级失步导致的遮挡，补齐渲染器崩溃后的恢复；保留主动隐藏和最小化行为。

## 能做什么

- **工作陪伴**：有任务就工作，明确等待输入时优先催促；点击催促后轻等，输入解决后恢复。
- **完成报信**：默认等全部已观察任务连续空闲 2 秒再合并报告，气泡最多保留 5 分钟，点击收起，新任务让位。也可说“接下来谁先完成就叫我”，只托付下一次完成。
- **自然互动**：理解退场、挽留、查询和提醒约定；同次回复可选择开心、害羞、挥手等原作动作，无固定口令台词。
- **额度提示**：独立授权并核对 Air 最近账号后，展示可用的 Codex 窗口读数；未知就显示未知，额度表情复用作者动画。
- **桌面交互**：触屏拖动、原物理甩飞、触摸菜单、长气泡滚动和多屏热插拔适配。

右键肥鱼 → 对话。模型理解会有误差，“下个完成”指接受托付后首先观察到的完成事件，不绑定指定对话或队列项，也不会替你操作 Air。

## 文档与开发

- [安装与撤销](docs/INSTALL.md)：准备环境、应用扩展、可选动画与账号连接。
- [互动规则](docs/INTERACTION.md)：并行、催促、一次性托付和已知边界。
- [数据与授权](docs/PRIVACY.md)：读取范围、模型用量和本地凭据。
- [开发与验证](docs/DEVELOPMENT.md)：结构、干净测试、上游审查和发布范围。
- [版本记录](CHANGELOG.md) · [原作与许可](UPSTREAM.md)

实现位于 `src`，安装/验证工具位于 `scripts`，必要回归位于 `test`，使用说明位于 `docs`。本地安装恢复数据放在被忽略的 `.local` 中；不要删除正在使用的安装清单和回滚原件。
