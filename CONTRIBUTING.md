# Contributing

感谢你帮助改进 星界罗盘 [Circinus ad Astra]。本项目是 Windows 桌面 Mod 编辑器；任何贡献都应保持 Mod 数据隔离、文件写入边界和可回放的保存历史。

## 提交 Issue

请先搜索现有 Issue。新问题应尽量提供：

- 星界罗盘 [Circinus ad Astra] 版本、Windows 版本，以及从 Release 运行还是从源码运行；
- Starsector 目录还是独立 Mod 目录、相关游戏版本，以及是否配置了游戏目录；
- 最小复现步骤、预期结果、实际结果和截图；
- 可脱敏的报错文本或日志上下文。

请不要上传完整的游戏目录、未获许可的原版资源、个人绝对路径、存档或其他敏感数据。能复现问题的最小 Mod 样例更有帮助。

## 开发准备

开发必须使用 Node.js（含 npm）、`rust-toolchain.toml` 固定的 Rust 1.95.0 MSVC 工具链，以及 Windows。安装依赖并启动开发模式：

```powershell
npm install
npm.cmd run tauri -- dev
```

生产可执行文件可通过下列命令生成：

```powershell
npm.cmd run tauri -- build --no-bundle
```

产物默认位于 `src-tauri\target\release\circinus-ad-astra.exe`。不要在仍需保留的运行实例上直接使用 `build.ps1` 或 `build.bat`：这两个便捷脚本会强制关闭应用并删除前端构建目录。

## 浏览器快速验证

`npm.cmd run test:browser` 启动支持热更新的浏览器入口，终端显示本次地址。默认打开设置场景；工具栏提供场景切换、明暗主题、重新打开、恢复样本和关闭场景。

| 场景         | 地址参数                                  | 操作                                                                 |
| ------------ | ----------------------------------------- | -------------------------------------------------------------------- |
| 设置         | `?case=settings`                          | 设置保存、默认值重置、目录选择、日志状态及性能调试样本               |
| CSV          | `?case=csv`                               | 50 行、40 列，搜索、编辑、增删、排序、撤销重做及保存                 |
| 沉浸式编辑器 | `?case=ship`、`weapon`、`wing`、`variant` | 正式字段输入、引用、历史及联合保存；装配包含武器、战机联队和插件动作 |
| 候选列表     | `?case=weapons`、`wings`、`hullmods`      | 每类 30 项，筛选、键盘导航、详情及选择                               |

数据保存在当前页面独立的内存样本中。重新打开保留已保存结果，恢复样本建立新状态，切换场景链接重新建立页面。原生目录和窗口动作交付样本结果。性能监视默认关闭。

浏览器宿主消费正式前端组件、输入、查询、历史和保存编排。`src/test/browser/native.ts` 由专属 Vite 配置替换原生接口，`model.ts` 保存样本，`commands.ts` 按正式请求与响应交付结果。未支持的命令在错误中给出名称。

控制台中的 `browserTest.host.model.failures` 可注入一次读取或保存失败，例如 `browserTest.host.model.failures.set('save_joint_edit', '样本保存失败')`。下一次对应命令消费该失败，随后恢复正常；`browserTest.eventListenerCount()` 提供本页事件监听数量。

### 基准与调用栈

`node scripts/performance/retained-lists.mjs after` 构建并启动独立基准入口；页面提供单轮流程检查和 30 轮正式采样。`?case=csv-50` 等参数选择具体规模；`before <git-ref>` 使用指定版本的生产来源，`monitor-removed` 移除监视能力，`?monitor=on` 启用采集。

基准报告附带构建、脚本哈希、窗口、DPR、缓存条件、profiler 状态、原始样本和统计。统计包括最小、最大、平均、中位数与 nearest-rank P95；偶数样本中位数取中间两值的平均。CPU 调用栈由 `node scripts/performance/profile.mjs <DevTools地址> <输出.cpuprofile> <毫秒>` 独立采集。

## 改动要求

- 先确认目标模块和保存 owner；组件不能直接读写磁盘，前端不能绕过 `shared/api` 与 Rust command/service 边界。
- 任何按 Mod 归属的状态、缓存、草稿与历史都必须以 `modRoot` 隔离；原版数据只作为正式的只读回退来源。
- 保存、删除、导入和撤销重做必须通过所属 changeset 链路；不要用临时写盘或兼容分支绕开它。
- 行为、边界或架构变化需要同步更新对应 Markdown 契约。维护细则见 [AGENTS.md](./AGENTS.md) 与 [.zcode/](./.zcode/)。
- 保留与当前 Pull Request 无关的用户修改；不要提交 `dist/`、`src-tauri/target/`、日志或本机游戏数据。

## 借助 AI 进行开发？

- 为确保提交质量，如需使用 AI 进行辅助编码，请使用能力达到或超过 `GPT-6.1 Sol`、`Claude Opus 5.5` 之中任一程度的模型。
- 这能显著减轻复核负担，并降低发生意外的概率。感谢配合。

## 提交前验证

至少运行与改动范围相符的检查；跨层改动默认运行完整集合：

```powershell
npm.cmd run format:check
npm.cmd run encoding:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri\Cargo.toml
```

如改动涉及交互、主题、文件保存或游戏目录，请在 Pull Request 中分别说明自动化检查与手动验证；自动化通过不替代真实 Mod 和 GUI 验证。

## Pull Request

请说明问题、设计边界、用户可见行为、验证结果和未覆盖的手动场景。每个 Pull Request 应聚焦一个可审查目标，并确保新增第三方代码、图片和文档均与 [GPL-3.0](./LICENSE) 兼容。
