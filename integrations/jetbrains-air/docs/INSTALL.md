# 安装与撤销

## 准备原版

首版验证环境为 Windows x64、Node.js 22+、dsh-pet 0.2.11、DSH 0.1.5-rc.1。先安装并启动原版一次，在原设置页完成模型配置，选择桌面显示并启用工作状态。确认原版正常后关闭 DSH，避免安装期间覆盖仍在使用的文件。

```powershell
npm install -g @deepseek-ai/dsh@0.1.5-rc.1 pnpm
dsh plugin --profile web add dsh-pet@0.2.11
dsh web
```

以上会安装软件并启动原版。已有相同版本可跳过；其他版本不要直接套用补丁。模型凭据仍由 DSH 管理。

## 应用 Air 扩展

在解压后的扩展目录，或仓库 `integrations/jetbrains-air` 中打开 PowerShell：

```powershell
npm run prepare:upstream
npm run install:local
npm run install:touch
npm run configure:animations
npm run configure:persona
npm run status
```

安装无需额外 npm 运行依赖。准备命令下载约 65 MB 解压体积的固定原包，验证锁定的 SHA-512；安装器检查 0.2.11、内容与补丁锚点，保存干净原件并拒绝覆盖未知改动。两个安装命令分别修改宿主与七个 Web/桌面成品；都完成后再启动 DSH。安装记录属于这个扩展目录，升级时保留该目录的 `.local`，不能只把新文件解压到别处再覆盖已打补丁的插件。

动画配置命令复用原素材，为工作、等待输入和对话表情建立独立别名，备份原配置并更新对应槽位；不添加新生成素材。要求原版已初始化 `main-config.json`。已有自定义工作/等待动画时，请先备份配置，或跳过此命令继续使用原动画；六种新增对话表情需要此配置。

人设配置命令将肥鱼的原文角色口诀写入用户配置的 `whisperPrompt`，聊天、碎碎念和 Air 报信共用；首次执行备份原配置，重复执行不重复覆盖。已有自定义人设也会被本命令替换，可跳过此命令保留。人设作用于口吻，不改变工具协议、真实状态或超时取消。主配置中的其他宠物也可能继承此人设，独立种类配置可自行覆盖。

默认使用当前用户的 `.dsh`。自定义安装可先设置 `$env:DSH_HOME`，安装器、动画和人设工具使用同一根目录。

## 启动与可选额度连接

```powershell
& .\scripts\start-pet.ps1
```

脚本从 PATH 定位 Node 和 npm 全局 DSH，隐藏启动本地 3080 端口服务；不会自动设置开机启动或快捷键。原设置页可配置显示切换热键。启动日志保存在 DSH 用户目录的 `dsh-pet/host.log`，其中的登录链接包含 token，请勿分享。

Air 工作状态无需额外模型账号连接。要显示 Codex 额度，在 Air 已登录对应 ChatGPT 账号、具有其附带的 Codex 程序时运行：

```powershell
& .\scripts\connect-gpt.ps1
```

在浏览器里完成独立授权；身份匹配且窗口有效才显示额度。此辅助脚本和 `toggle-pet.ps1` 使用上述启动日志、127.0.0.1 和 3080；自定义端口需要自行调整。授权不是启动桌宠的必要步骤。

## 从 0.1.0 / 0.1.1 更新到 0.1.2

退出 DSH，将新版 ZIP 中的文件覆盖到原扩展目录，**保留原目录的 `.local` 安装清单和恢复原件**。然后运行 `npm run prepare:upstream`、`npm run install:touch`、`npm run status`，重新启动 DSH 并刷新 Web。0.1.2 更新桌面窗口恢复与层级维护，不需要重新配置动画或账号。不要删除旧目录后再安装到新路径。

## 源码新增：肥鱼人设（尚未发布）

已有安装可在更新仓库后运行 `npm run install:local` 和 `npm run configure:persona`，再重启 DSH。前者更新自动报信口吻，后者应用原文人设；无需重配动画或账号。

## 更新与撤销

先退出 DSH，再执行：

```powershell
npm run restore:persona # 仅在执行过 configure:persona 时使用
npm run uninstall:touch
npm run uninstall:local
```

`restore:persona` 只恢复安装前的人设字段，保留其他设置；如果人设之后被手动修改，会拒绝覆盖。完整备份位于 `.local/before-persona-config-*.json`，恢复记录为 `.local/persona-installation.json`。

随后重新启动 DSH 并刷新 Web。两个卸载命令恢复原版成品；不会删除模型配置、聊天记忆、动画别名或独立授权。动画修改前的配置备份在 `.local/before-*-config-*.json`，需要撤销动画时只恢复对应槽位，避免覆盖后来配置。

只有通过本扩展启动的默认服务才使用 `stop-pet.ps1` 关闭；它会中断对应 DSH 会话。若发现“changed externally”或版本不符，停止操作并核对来源，不要删除安装记录强行覆盖。独立额度授权的存储说明见[数据与授权](PRIVACY.md)。
