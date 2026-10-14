# Workflow

本文件维护任务调查、修改和验证协议。项目架构与运行边界见 `.zcode/overview.md`。

## 改动前

- 前端任务读取 `.zcode/frontend-guidelines.md`。
- Rust 任务读取 `.zcode/backend-guidelines.md`。
- 视觉任务读取 `.zcode/css-guidelines.md`。
- 读取 `.zcode/module-map.md`，再按命中线索加载直接相关的模块文档。

## 面向模块开发

- 模块干净大于一切。
- `.zcode/modules/` 不进入默认上下文，按任务要求加载。
- 修改前必须按模块索引、模块文档和实际调用链确定归属。
- 除非用户显式授权具体模块及改动内容，严禁跨模块修改。
- 除非用户显式、明确、指名道姓地要求产生跨模块关系，否则模块之间严禁任何程度的耦合。
- 模块自身的问题必须在模块内部解决，严禁转嫁给 shared 或公用组件。
- shared、公用组件及其接口只允许原样复用；修改必须取得专项明确授权。
- 任何评估、计划和方案必须明确说明修改所涉及的模块，并自我审查是否出现意外的跨模块行为。
- 严禁把业务目标、读取依赖或笼统计划批准当作跨模块授权。

## 奥卡姆剃刀式开发

- 如无必要，勿增实体。
- 一切改动必须先取得用户显式输入的新增行数上限，未取得时严禁写入。
- 行数必须覆盖本次全部源码、测试、文档及新增文件，以实施前工作树为基线。
- 必须分别统计格式化后的新增与删除物理行；严禁抵扣、压缩、移出或拆分规避预算。
- 必须尊重默认行为和默认流程；任何默认设计必须完整审慎核对实际调用链。
- 改变默认行为或流程必须取得用户明确授权；重大故障必须先举证并确认，严禁自行例外。
- 必须完整查找并复用模块内部或 shared 的正式流程，严禁重复手写已有能力。
- 一切改动必须采用最简洁的实现，优先删除与收敛，以多删少加为目标。
- 严禁引入未经要求的功能、通用机制、额外状态或分支。

## 问题处理

- 必须沿用户入口、调用、状态、数据与最终结果完整取证，确定根因。
- 若 bug 对根因、影响和修正点均单一，则允许作局部修正。
- 其余问题必须在所属模块统一重做，且一次覆盖所有可达同类问题。
- 严禁修补式堆叠、样例特判和重复分支；必须验证完整受影响链路。

## 验证方式

- 文档和配置改动必须运行 `format:check`、`encoding:check` 与 `git diff --check`。
- 前端或架构规则改动必须运行 `format:check`、`encoding:check`、`lint`、`typecheck`、`test` 与 `build`。
- Rust 改动必须运行 `cargo fmt --check`、`cargo clippy --all-targets -- -D warnings` 与 `cargo test`。
- 跨层、保存、路径、parser、workspace 或发布链路改动必须运行全部检查。
- 视觉改动必须人工检查。

## 常用命令

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
git diff --check
```

- 开发运行使用 `npm.cmd run tauri -- dev`。
- 无安装包构建使用 `npm.cmd run tauri -- build --no-bundle`，产物位于 `src-tauri\target\release\circinus-ad-astra.exe`。
- 验证失败时必须报告完整命令、退出码、失败位置和阻塞条件；命令必须执行到自然结束。

## 事后要求

- 行为、架构、所有权、调用链、保存边界或长期规范变化时，必须在得到用户授权的前提下同步对应 guideline、module map 或模块契约。
- 文档必须只描述当前有效事实，严禁记录实现过程、迁移历史、临时状态或候选方案；阶段任务只允许写入 `.zcode/todo.md`。
- 复查性能开销，确认改动是否产生任何程度的性能问题。特别是时间开销。
