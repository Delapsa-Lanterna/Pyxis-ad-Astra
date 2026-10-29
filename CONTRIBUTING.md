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

开发必须使用 Node.js (含 npm)、`rust-toolchain.toml` 固定的 Rust 1.95.0 MSVC 工具链，以及 Windows。安装依赖并启动开发模式：

```powershell
npm install
npm.cmd run tauri -- dev
```

生产可执行文件可通过下列命令生成：

```powershell
npm.cmd run tauri -- build --no-bundle
```

产物默认位于 `src-tauri\target\release\circinus-ad-astra.exe`。不要在仍需保留的运行实例上直接使用 `build.ps1` 或 `build.bat`：这两个便捷脚本会强制关闭应用并删除前端构建目录。

## 浏览器模拟与性能测试台

`npm.cmd run dev-browser` 启动测试工作区，地址为 `http://127.0.0.1:1461`。
`npm.cmd run dev-testbed` 启动性能测试台，地址为 `http://127.0.0.1:1462`。

地址参数 `?scene=csv&count=300&theme=dark` 选择独立场景、规模和主题。

共享基础位于 `src/test/`：
数据工厂位于 `fixtures/`，单元测试辅助位于 `unit/`，
浏览器模拟、场景、操作和基准位于 `browser/`。
`scripts/browser/` 提供服务、生产构建、浏览器执行及报告。

测试台提供 CSV 与三类候选列表的规模基准、重复使用压力和资源压力，点击预览或执行后加载样本。
默认预热 2 次、正式测量 30 次；重复使用压力默认正式测量 100 次。
资源压力使用 32、128、512 像素的独立固定生成图片。
交替比较支持多份页面地址及监视开关，按轮次轮换起始组。
同对象双组对照使用同一地址的两个独立页面。

### 自动执行

正式性能采样必须使用生产构建。
下列命令连接已运行的浏览器服务、启动 Edge、执行项目并保存 JSON 与 Markdown 报告：

```powershell
npm.cmd run test:browser -- --suite smoke
npm.cmd run test:browser -- --suite ui
npm.cmd run test:browser -- --suite browser-ui
npm.cmd run test:browser -- --suite lists
npm.cmd run test:browser -- --suite stress
npm.cmd run test:browser -- --suite resources
npm.cmd run test:browser -- --suite smoke --scene weapons --aa
npm.cmd run test:browser -- --suite lists --scene csv --count 50 --monitor-compare
```

`--warmup 2 --rounds 30` 指定预热和测量次数。
`--first-open` 为每次首次打开创建新浏览器上下文并单独记录。
`--output <report.json>` 指定报告位置。
默认输出位于 `node_modules/.cache/browser/reports/`。
`--url` 指定已运行服务；默认工作区验收连接 1461，其余项目连接 1462。

两份构建的准备和执行方式如下：

```powershell
node scripts/browser/serve.mjs testbed --production --directory node_modules/.cache/browser/A
node scripts/browser/serve.mjs testbed --production --directory node_modules/.cache/browser/B
npm.cmd run test:browser -- --url http://127.0.0.1:端口A --variant A,http://127.0.0.1:端口A,off,code --variant B,http://127.0.0.1:端口B,off,code
```

`--existing` 使用指定目录中的已构建产物。
`--no-monitor-code` 构建移除前端监视代码的对照样本。
比较策略 `disabled` 使用 1% 或 1 ms 的增量上限，
`enabled` 使用 10% 或 5 ms 的增量上限；两者均取较大值。
`code` 记录代码构建间差异。
行为失败和已有预算超限必须返回失败退出码。

报告包含完整构建哈希、样本参数、运行设置、浏览器、视口、DPR、缓存条件、
逐轮顺序、预热及正式样本，以及最小值、最大值、均值、中位数和 nearest-rank P95。
首次打开与预热后结果必须分别判读。
CPU 采样由 `node scripts/performance/profile.mjs <DevTools地址> <输出.cpuprofile> <毫秒>` 执行。
真实 EXE 的 CSV 测量由 `scripts/browser/csv-desktop.mjs` 执行。

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
npm.cmd run lint
npm.cmd run lint:rust
npm.cmd run lint:checks
npm.cmd run typecheck
npm.cmd run test
npm.cmd run test:rust
npm.cmd run test:checks
npm.cmd run build
```

如改动涉及交互、主题、文件保存或游戏目录，请在 Pull Request 中分别说明自动化检查与手动验证；自动化通过不替代真实 Mod 和 GUI 验证。

## Pull Request

请说明问题、设计边界、用户可见行为、验证结果和未覆盖的手动场景。每个 Pull Request 应聚焦一个可审查目标，并确保新增第三方代码、图片和文档均与 [GPL-3.0](./LICENSE) 兼容。
