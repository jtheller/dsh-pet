# 开发与验证

## 结构

上游目录和根 README 原文保留；本扩展全部集中在 `integrations/jetbrains-air`。

| 位置 | 职责 |
| --- | --- |
| `src/theater.mjs`、`visibility.mjs` | 模型工具协议、延迟动作、原配置显示链 |
| `src/attention.mjs`、`usage-monitor.mjs`、`companion.mjs` | 生命周期、用量事件和提醒约定 |
| `src/codex-quota.mjs` | 独立授权、身份核对、只读额度 |
| `src/touch.mjs`、`input-overlay.mjs` | 共用展示、触控和 Windows 输入区域 |
| `src/patch.mjs`、`touch-patch.mjs` | 固定上游成品的宿主与 UI 适配 |
| `scripts` | 可复现依赖准备、安装/撤销、配置和验证 |
| `test` | 必要自动化回归，保留真实原作播放器与解码器检查 |
| `docs` | 精简后的使用与维护说明 |

首版保留已验证的适配器方案；上游源码未直接改写。宿主补丁修改 `lib/index.js`，UI 安装器处理 `lib/client.js` 和 `runtime/electron-helper` 的 renderer、preload、main、shared-core、sprite、events。复用原设置、动画、物理和模型链。

## 可复现测试

Windows 上安装 Microsoft Edge，再在扩展目录运行：

```powershell
npm ci --ignore-scripts
npm test
npm run test:install
```

`pretest` 下载并验证固定 npm 原包，在 `.local/test-runtime` 构建隔离 UI；测试不再读取开发者的插件安装或历史 `.before-pet-stage` 文件。Edge 测试验证真实播放器与浏览器行为；缺少 Edge 不能视为完整验收。

安装烟雾测试在临时 `DSH_HOME` 内验证八个补丁、重复安装、哈希状态、拒绝未知编辑、动画配置和逐字节卸载，结束后删除自己的临时目录，不重启真实 DSH。

## 深度上游审查

维护者可运行保留的 `audit:upstream`。它需要当前扩展目录对应的安装/回滚记录，以及 `.local/upstream-0.2.11` 中的干净上游提交 `8f57010f4517d06c0d9ae4efb60cdbd7abde21c3`；用 `git clone --branch v0.2.11 --single-branch https://github.com/PC2005-cloud/dsh-pet.git .local/upstream-0.2.11` 准备。原包由 `prepare:upstream` 提供。

该检查比较原包、备份、已安装文件和固定源码，并运行原作 177 项测试；不是首次安装的必要步骤。不要把上游测试通过写成所有本地硬件组合均已验收。

## 发布范围

运行实现、安装工具、回归和精简文档进入仓库与扩展 ZIP。旧口令实现、开发对话、阶段方案、机器专属维护记录、测试聊天原文、`.local`、`node_modules`、备份和生成日志不发布。ZIP 附带 MIT 许可及 SHA-256 校验值，不捆绑账号或开发机配置。

修改适配器前核对上游调用链与版本，未知成品拒绝覆盖；以后升级保留安装目录的恢复记录。上游已发布的新版本应另做兼容审查，本扩展暂不自动跟随。
