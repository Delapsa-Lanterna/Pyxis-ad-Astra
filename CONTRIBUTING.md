# Contributing

感谢你帮助改进 星界罗盘 [Pyxis ad Astra]。本项目是 Windows 桌面 Mod 编辑器，贡献时请保持 Mod 数据隔离、文件写入边界和可回放的保存历史。

## 反馈问题

提交 Issue 前请先搜索现有问题。为了方便定位，请尽量提供以下信息：

- 星界罗盘 [Pyxis ad Astra] 版本、Windows 版本，以及从 Release 运行还是从源码运行。
- Starsector 目录还是独立 Mod 目录、相关游戏版本，以及是否配置了游戏目录。
- 最小复现步骤、预期结果、实际结果和截图。
- 脱敏后的报错文本或日志上下文。

能复现问题的最小 Mod 样例更有帮助。

## 准备环境、启动与构建

开发环境如下，版本要求见 [package.json](package.json) 与 [rust-toolchain.toml](rust-toolchain.toml)：

- 操作系统：Windows。
- Node.js (含 npm)：`^22.13.0 || >=24.0.0`。
- Rust：`1.99.1`，MSVC 工具链。

### 安装与启动

```powershell
npm install
npm.cmd run tauri -- dev
```

### 构建可执行文件

```powershell
npm.cmd run tauri -- build --no-bundle
```

产物默认位于 `src-tauri\target\release\pyxis-ad-astra.exe`。

`build.ps1` 和 `build.bat` 会强制关闭应用并删除前端构建目录。使用这两个脚本前，请确认当前应用实例可以关闭、前端构建目录可以清理。

## AI 辅助开发

使用 AI 辅助编码时，请使用 `Artificial Analysis Intelligence Index v5.0` 分数达到或超过 `GPT-6.1 Sol (high)` 的模型/推理配置。这有助于减轻复核负担并降低意外发生的概率。

## 提交前检查

提交前请运行与改动范围相符的检查。跨层改动默认使用以下完整集合：

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

涉及交互、主题、文件保存或游戏目录的改动，请结合真实 Mod 和 GUI 验证，并在 Pull Request 中分别说明自动化检查与手动验证结果。

## 提交 Pull Request

每个 Pull Request 请聚焦一个可审查目标，并说明以下内容：

- 问题与设计边界。
- 用户可见行为。
- 验证结果与待完成的手动验证场景。

新增第三方代码、图片和文档必须与 [GPL-3.0](LICENSE) 兼容。

## 浏览器预览、自动测试与性能测量

### 模块入口

`src/test/browser/preview/` 提供功能工作区、展示样本与正确性场景；`src/test/browser/testbed/` 提供规模、压力与性能场景。`scripts/browser/` 提供服务、构建与外部驱动，公共报告与统计位于 `scripts/shared/`。

### 构建与启动

#### 功能预览与测试台

```powershell
npm.cmd run dev:browser-preview
npm.cmd run dev:browser-testbed
```

功能预览默认地址为 `http://127.0.0.1:1461`，开发测试台为 `http://127.0.0.1:1462`。功能预览的子窗口目录提供代码编辑器体验入口。测试台提供 CSV、选择列表、两类文本编辑器及五类沉浸式编辑器的参数、样本、测量和报告导出。

#### 公开演示

```powershell
npm.cmd run build:demo -- --base /Pyxis-ad-Astra/
npm.cmd run dev:browser-preview -- --production --existing --directory dist/browser-demo --base /Pyxis-ad-Astra/ --port 1463
```

演示产物位于 `dist/browser-demo/`。

#### 比较两份构建

```powershell
npm.cmd run dev:browser-testbed -- --production --directory node_modules/.cache/browser/A
npm.cmd run dev:browser-testbed -- --production --directory node_modules/.cache/browser/B
npm.cmd run test:browser-testbed -- --variant A,http://127.0.0.1:端口A,off --variant B,http://127.0.0.1:端口B,off --scene csv
```

### 自动执行

功能正确性及体验验收连接已运行的 preview：

```powershell
npm.cmd run test:browser-preview
npm.cmd run test:browser-preview -- --scene workspace
npm.cmd run test:browser-preview -- --scene editors
npm.cmd run test:browser-preview -- --scene java-analysis
```

规模与压力测量连接已运行的 testbed，正式采样使用生产构建：

```powershell
npm.cmd run test:browser-testbed -- --scene csv
npm.cmd run test:browser-testbed -- --scene weapons --workload stress
npm.cmd run test:browser-testbed -- --scene weapons --workload resources
npm.cmd run test:browser-testbed -- --scene code-editor
npm.cmd run test:browser-testbed -- --scene text-editor
npm.cmd run test:browser-testbed -- --scene ship --files 50 --url http://127.0.0.1:1464
npm.cmd run test:browser-testbed -- --check-ui
```

资源寿命检查：`npm.cmd run test:resources`。

### 执行参数

- `--url <地址>`：指定已运行服务，preview 默认连接 1461，testbed 默认连接 1462。
- `--scene <名称>`：选择所属场景，preview 默认执行全部功能场景，testbed 默认执行全部测量场景。
- `--rows 300`、`--entries 100`、`--files 50`：分别指定表格行数、列表条目数和文件数；沉浸式场景的文件数表示无关装配文件规模。
- `--bytes 10485760 --shape multiline`：指定文件字节数和文本形态，超长行采用 `long-line`。
- `--execution page|keyboard`：编辑器采用页面内操作或真实按键，自动测量默认真实按键；测试台页面执行页面内操作。
- `--workload benchmark|stress|resources`：选择基准、重复使用压力或资源压力；资源压力采用武器列表。
- `--warmup 2 --rounds 30`：指定预热及正式轮次；重复使用压力默认测量 100 次。
- `--first-open`：使用独立浏览器上下文记录首次打开。
- `--aa`、`--monitor-compare`：执行同对象双组对照或性能监视开关对照。
- `--output <report.json>`：排他预留 JSON、Markdown 与附件目录。

构建参数：`--production` 使用生产构建，`--existing --directory <目录>` 使用指定产物，`--no-monitor-code` 构建移除前端监视代码的样本。

交替比较记录各组中位数、P95 和实际差值，原始采样及操作结果随报告交付。生产测试台采用独立构建并连接明确地址，例如 `http://127.0.0.1:1464`；开发预览与生产测量分别记录实际构建环境。

### 报告与资源管理

功能结果进入 `checks`，测量结果进入 `runs`。报告包含场景、参数及单位、实际采样次数、操作方式与完成条件、构建、浏览器、视口、DPR、原始样本、统计、断言及释放结果。浏览器样本保存和原生磁盘保存分别记录。

报告默认位于 `node_modules/.cache/browser/preview/reports/` 或 `node_modules/.cache/browser/testbed/reports/`。每次运行排他持有报告及附件，失败保留已完成的样本与原始错误。执行结束释放所属浏览器连接与上下文，测试服务按独立寿命管理并持续复用。

- CPU 采样：`node scripts/performance/profile.mjs <DevTools地址> <输出.cpuprofile> <毫秒>`。

## 桌面测试

### 模块入口

`scripts/desktop/` 提供独立应用构建、真实窗口驱动、来源同步、编辑器验收与性能测量；`src/test/desktop/` 提供页面探针。

### 构建与启动

```powershell
npm.cmd run build:desktop
```

独立可执行文件位于 `src-tauri/target/desktop-testing/release/pyxis-ad-astra.exe`，调试端口为 `9233`。Tauri 构建前运行正式 `build` 流程一次；测试运行器以普通用户权限在当前用户桌面启动应用，`--isolated-desktop` 使用独立 Windows 桌面。

### 自动执行

来源同步、代码编辑器验收与显示性能测量：

```powershell
npm.cmd run test:desktop -- --suite sources
npm.cmd run test:desktop -- --suite sources --isolated-desktop
npm.cmd run test:desktop -- --suite code-editor
npm.cmd run test:desktop -- --suite workspace-opening
npm.cmd run test:desktop -- --suite workspace-opening --mod D:/game/mods/sample --game D:/game
npm.cmd run test:desktop -- --suite workspace-opening --game D:/game
npm.cmd run test:desktop -- --suite editor-performance --count 50 --rounds 30
npm.cmd run test:desktop -- --suite editor-performance --count 10 --bytes 1048576 --shape multiline
npm.cmd run test:desktop -- --suite weapons --count 100
npm.cmd run test:desktop -- --suite wings --count 100
npm.cmd run test:desktop -- --suite hullmods --count 100
npm.cmd run test:desktop -- --suite immersive-performance --count 50 --warmup 2 --rounds 30 --isolated-desktop
npm.cmd run test:desktop -- --suite csv --rounds 30
npm.cmd run test:desktop -- --suite source-performance --mod D:/game/mods/sample --game D:/game --rounds 30 --soak 600
```

资源寿命检查：`npm.cmd run test:resources`。

### 执行参数

- `--exe <可执行文件>`：指定使用相同桌面测试配置构建的应用。
- `--isolated-desktop`：在独立 Windows 桌面内运行应用及子窗口，用户输入桌面保持原状；默认窗口显示在当前用户桌面。
- `--mod <目录>`：工作区打开验收按原路径打开指定 Mod；其它测量套件复制该 Mod 作为本次样本。
- `--game <目录>`：指定工作区打开或来源性能使用的游戏根；工作区验收同时提供 Mod 时先打开游戏目录，再打开目标 Mod。
- `--soak 600`：来源性能测量在固定轮次之后执行 600 秒混合负载；`0` 表示仅测固定轮次。
- `--phase cold|warm|all`：选择首次进入、返回与滚动或完整测量。
- `--count 50 --warmup 2 --rounds 30`：指定生成样本规模、预热及正式测量次数。
- `--bytes 1048576 --shape multiline`：指定编辑器文件大小和文本形态；文件大小默认 10 MiB，形态默认执行 `multiline` 与 `long-line`。
- `--screenshots`：保存 CSV 测量窗口的明暗与宽窄截图。
- `--output <report.json>`：排他预留 JSON、Markdown 与附件目录。
- `--dry-run`：输出实际配置。

### 报告与资源管理

JSON 与 Markdown 报告包含场景参数、可执行文件及脚本哈希、窗口环境、逐项断言耗时、原始测量、统计、诊断和资源释放结果。报告、日志与截图位于 `node_modules/.cache/desktop-testing/reports/`，样本在所属工作区中生成或复制。

工作区打开每项执行一次，在本次独占工具目录启用已有性能监视，工具缓存为空、系统缓存保留。`runs[].resources.timing` 记录页面动作、状态就绪、随后两帧及驱动观测的时间点，命令按请求编号关联往返、后端及响应审计耗时，并附带原生阶段和完整时间线文件。`samples[].metrics` 分别记录动作发送等待、动作至绘制帧、关键响应至状态就绪、绘制帧等待、驱动观测等待及后端区间并集，单位为毫秒；工作区总耗时覆盖游戏目录和目标 Mod 的连续操作。

来源性能覆盖 Mod 信息、CSV、同内容写回、连续写入、无变化及有变化重扫，并分别测量一个与两个同根会话。报告附带原生应用及 WebView 的 CPU、私有内存、查询次数、堆指标和最终堆快照。

来源性能在页面就绪后交接到直接 CDP 驱动，释放 Playwright 的网络观测连接；该驱动采集页面异常、计时和堆信息，测量阶段保持原生渲染与窗口行为。

来源性能的直接连接持有 1360×860、DPR 1.5 的视口设置，在驱动交接后和负载结束时核对页面尺寸及实际布局。

## Java 分析构建与验收

### 模块入口

`src-tauri/java-analysis/` 提供分析库、Java 宿主及内置资源；`scripts/java-analysis/` 提供构建和验收。环境及接口见 [组件说明](src-tauri/java-analysis/README.md)。

### 构建与启动

Java 宿主重建使用完整 JDK 17 和 Maven，`JAVA_HOME` 指定 JDK。

```powershell
npm.cmd run build:java-analysis
```

### 自动执行

```powershell
npm.cmd run check:java-analysis
npm.cmd run test:java-analysis -- --game <游戏根>
```

### 执行参数

- `--game <目录>`：指定包含 Java 17 和正确性基准的外部游戏根。
- `--download`：从固定清单下载依赖，默认导入构建生成的离线包。
- `--warmup 2 --rounds 30`：指定性能对照的预热及正式轮次。
- `--output <report.json>`：排他预留报告及所属命令目录。
- `--dry-run`：输出实际配置。

### 报告与资源管理

报告默认位于 `src-tauri/target/java-analysis/reports/` 的本次运行目录，包含源码及资源指纹、javac 对照、增量与完整分析采样、统计和资源释放结果。来源 Mod 按外部只读目录使用，样本与 JVM 工作区归本次运行持有。
