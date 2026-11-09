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

`scripts/browser/` 提供服务、生产构建、浏览器执行及报告；`src/test/browser/` 提供浏览器模拟、场景、操作和基准。共享基础位于 `src/test/`：`fixtures/` 提供数据工厂，`unit/` 提供单元测试辅助。

### 构建与启动

#### 预览与测试台

- 浏览器测试工作区：`npm.cmd run dev:browser`，默认地址为 `http://127.0.0.1:1461`。
- 性能测试台：`npm.cmd run dev:testbed`，默认地址为 `http://127.0.0.1:1462`。

地址参数 `?scene=csv&count=300&theme=dark` 选择独立场景、规模和主题。测试台提供各类候选列表的规模基准、重复使用压力和资源压力，点击预览或执行后加载样本。

#### 公开演示

```powershell
npm.cmd run build:demo -- --base /Pyxis-ad-Astra/
npm.cmd run dev:browser -- --production --existing --directory dist/browser-demo --base /Pyxis-ad-Astra/ --port 1463
```

演示产物位于 `dist/browser-demo/`。

#### 比较两份构建

先分别准备两份生产构建，再使用各自服务输出的端口填写测量命令：

```powershell
npm.cmd run dev:testbed -- --production --directory node_modules/.cache/browser/A
npm.cmd run dev:testbed -- --production --directory node_modules/.cache/browser/B
npm.cmd run test:browser -- --url http://127.0.0.1:端口A --variant A,http://127.0.0.1:端口A,off,code --variant B,http://127.0.0.1:端口B,off,code
```

### 自动执行

正式性能采样必须使用生产构建。以下命令连接已运行的浏览器服务、启动 Edge、执行测试，并保存 JSON 与 Markdown 报告。

基础采样与界面验收：

```powershell
npm.cmd run test:browser -- --suite smoke
npm.cmd run test:browser -- --suite ui
npm.cmd run test:browser -- --suite browser-ui
npm.cmd run test:browser -- --suite code-editor
npm.cmd run test:browser -- --suite java-analysis
```

列表及代码编辑器基准、重复使用压力与资源压力：

```powershell
npm.cmd run test:browser -- --suite lists
npm.cmd run test:browser -- --suite stress
npm.cmd run test:browser -- --suite resources
npm.cmd run test:browser -- --suite code-editor-performance
```

指定场景与对照测量：

```powershell
npm.cmd run test:browser -- --suite smoke --scene weapons --aa
npm.cmd run test:browser -- --suite lists --scene csv --count 50 --monitor-compare
```

资源寿命检查：`npm.cmd run test:resources`。

### 执行参数

- `--warmup 2 --rounds 30`：指定预热 2 次、测量 30 次。
- `--first-open`：为每次首次打开创建新浏览器上下文并单独记录。
- `--output <report.json>`：指定报告位置，默认位于 `node_modules/.cache/browser/reports/`。
- `--url <地址>`：指定已运行服务；工作区界面、代码编辑器及 Java 卡片场景默认连接 1461，testbed 场景连接 1462。

构建参数：

- `--existing`：使用指定目录中的已构建产物。
- `--no-monitor-code`：构建移除前端监视代码的对照样本。

比较策略：

- `disabled`：增量上限取 1% 与 1 ms 中的较大值。
- `enabled`：增量上限取 10% 与 5 ms 中的较大值。
- `code`：记录代码构建间差异。

行为失败和已有预算超限必须返回失败退出码。

### 报告与资源管理

报告包含完整构建哈希、样本参数、运行设置、浏览器、视口、DPR、缓存条件、逐轮顺序、预热及正式样本，以及最小值、最大值、均值、中位数和 nearest-rank P95。首次打开与预热后结果请分别判读。

报告与截图位于 `node_modules/.cache/browser/reports/`。每次运行排他持有输出文件与截图目录，执行结束释放所属浏览器连接与上下文。测试服务器启停必须取得明确授权，已有可用服务必须持续保留并复用。

- CPU 采样：`node scripts/performance/profile.mjs <DevTools地址> <输出.cpuprofile> <毫秒>`。

## 桌面测试

### 模块入口

`scripts/desktop/` 提供独立应用构建、真实窗口驱动、来源同步验收与 CSV 显示性能测量；`src/test/desktop/` 提供页面探针。

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
npm.cmd run test:desktop -- --suite csv --rounds 30
npm.cmd run test:desktop -- --suite source-performance --mod D:/game/mods/sample --game D:/game --rounds 30 --soak 600
```

资源寿命检查：`npm.cmd run test:resources`。

### 执行参数

- `--exe <可执行文件>`：指定使用相同桌面测试配置构建的应用。
- `--isolated-desktop`：在独立 Windows 桌面内运行应用及子窗口，用户输入桌面保持原状；默认窗口显示在当前用户桌面。
- `--mod <目录>`：复制指定 Mod 作为本次测量样本。
- `--game <目录>`：来源性能测量使用的原版游戏根。
- `--soak 600`：来源性能测量在固定轮次之后执行 600 秒混合负载；`0` 表示仅测固定轮次。
- `--phase cold|warm|all`：选择首次进入、返回与滚动或完整测量。
- `--count 50 --rounds 30`：指定生成样本行数与测量次数。
- `--screenshots`：保存 CSV 测量窗口的明暗与宽窄截图。
- `--output <report.json>`：排他预留 JSON、Markdown 与附件目录。
- `--dry-run`：输出实际配置。

### 报告与资源管理

JSON 与 Markdown 报告包含场景参数、可执行文件及脚本哈希、窗口环境、逐项断言耗时、原始测量、统计、诊断和资源释放结果。报告、日志与截图位于 `node_modules/.cache/desktop-testing/reports/`，样本在所属工作区中生成或复制。

来源性能覆盖 Mod 信息、CSV、同内容写回、连续写入、无变化及有变化重扫，并分别测量一个与两个同根会话。报告附带原生应用及 WebView 的 CPU、私有内存、查询次数、堆指标和最终堆快照。

来源性能在页面就绪后交接到直接 CDP 驱动，释放 Playwright 的网络观测连接；该驱动采集页面异常、计时和堆信息，测量阶段保持原生渲染与窗口行为。

来源性能的直接连接持有 1360×860、DPR 1.5 的视口设置，在驱动交接后和负载结束时核对页面尺寸及实际布局。

桌面测试必须使用独立应用构建及所属工具目录；文件操作必须作用于本次样本，结束必须经正常关闭流程交还进程和目录。

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
