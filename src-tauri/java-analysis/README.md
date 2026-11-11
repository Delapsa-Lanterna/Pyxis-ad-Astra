# Java 分析

Java 分析模块提供 Java 17 语法与项目语义分析、固定依赖安装及实例寿命管理。Rust 包名为 `pyxis-java-analysis`，Java 包名为 `com.delapsalanterna.pyxis.javaanalysis`。

## 目录与运行态

- `src/`：安装模型、错误、协议、依赖、进程、配置目录和分析运行态。
- `examples/`：显式构建的开发检查命令行。
- `java/`：Java 17 Maven 工程、自有宿主及 JUnit。
- `resources/`：随应用编译交付的两个自有 JAR、宿主清单和固定 Maven 依赖清单。
- `tests/`：依赖安装、初始化和实际 Java 实例寿命测试。

应用服务 `java_analysis` 消费正式 `app_data_dir::data_directory`，将 `AnalysisRuntime` 登记到 Tauri 状态。初始化只登记描述，实际安装和启动由明确调用执行。

```text
配置目录/java-analysis/
  dependencies/<JDT 版本与清单哈希>/lib/*.jar
  workspaces/<实例标识>/
  logs/<实例标识>.log
```

每个实例独占工作区；正常关闭等待 Java 和读取线程结束，随后删除工作区并保留依赖和日志。应用确认关闭后调用 `shutdown`，等待全部已创建实例结束。操作事件进入正式诊断链，源码和请求正文由分析协议直接交付。

## Mod 会话与引用

应用服务 `start_for_session(app, session_id, java, extras)` 显式建立分析项目，`AnalysisExtras::default()` 消费当前正式来源；`inputs_for_session` 可读取实际输入、缺失依赖和缺失 JAR。该输入按当前 Mod、已发布可引用 Mod、游戏 Core 和补充来源装配。手动或自动标记为可引用的全部就绪 Mod 按标签顺序参与，标签前后均可提供类。

已启动 Mod 会话共用一个 JVM，各自保留源码和分析版本。`request_for_session` 核对所属项目并维护版本，`close_for_session` 释放单个分析项目；最后项目关闭后 JVM 退出。项目同步在注销 Mod 前释放其分析项目，在引用发布后增量刷新存活项目，当前内存文档继续保留。

补充路径属于某个 Mod 时，该 Mod 同样必须是当前 Mod 或已发布的可引用来源；普通独立库通过显式补充路径交付。

## 增量与测量

文件变化按声明签名、使用名称及依赖闭包确定重解析范围；正文变化保持外部签名时只重解析所属文件，声明增删、继承和导入变化传播至相关文件。JAR 按 SHA-256 和有效 class 条目比较，配置刷新只失效使用变化类型的文件；源码根调整更新相应工作副本，源码重名按根顺序选择。

JDT 在 AST 回调内固化紧凑的语义事实、诊断和引用位置，查询使用所属版本事实。`analyze` 的 `forceFull` 用于验收对照；语言或标准库变化记录完整重建原因。结果包含 `analysisMilliseconds`、`reparsedFiles`、`invalidatedFiles`、`incremental` 和 `fullFallbackReason`，响应另记录 `queueWaitMilliseconds`、`requestMilliseconds` 和 `responseBytes`。

运行态锁只保护实例登记，管道请求由实例锁顺序执行。共享 JVM 内请求顺序执行，独立 JVM 可以并行。完整验收在自建脱敏夹具上逐项对照增量与完整结果，并在外部真实 Mod 上记录实际正文修改、内存和首次查询延迟。

## 构建与验收

普通主程序构建通过 Cargo 路径依赖使用已准备的自有资源。完整 JDK 17 和 Maven 用于独立重建；`AST_JDK` 或 `JAVA_HOME` 指定开发 JDK，`AST_GAME` 或 `--game` 指定真实验收游戏根。

在仓库根运行：

```powershell
npm run build:java-analysis -- --dry-run
npm run build:java-analysis
npm run check:java-analysis
npm run test:java-analysis -- --game D:/Starsector
npm run test:java-analysis -- --game D:/Starsector --download
npm run test:browser-preview -- --scene java-queries
npm run test:browser-testbed -- --scene java-queries
npm run test:desktop -- --suite java-queries --game D:/Starsector --isolated-desktop
npm run test:browser-preview -- --scene source-actions
npm run test:desktop -- --suite source-actions --game D:/Starsector --isolated-desktop
$env:JAVA_ANALYSIS_TEST_JAVA = 'D:/Starsector/jre/bin/java.exe'
cargo test --manifest-path src-tauri/Cargo.toml -p pyxis-java-analysis --test runtime -- --include-ignored
$env:AST_GAME = '<游戏根>'
cargo test --manifest-path src-tauri/Cargo.toml -p pyxis-ad-astra live_sessions_share_jvm_and_refresh_only_affected_sources -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml -p pyxis-ad-astra live_correct_mods_use_the_published_reference_inputs -- --ignored --nocapture
```

构建输出位于 `src-tauri/target/java-analysis/`。Java 源码使用 google-java-format 1.24.0，Rust 和 Node.js 代码沿用主项目格式及检查入口。Java 构建重新核对第三方 JAR 哈希，依赖集合由锁文件决定。

专用 CI 任务在 JDK 17 下重建和测试宿主；真实 Mod 校验接受外部游戏目录。Polaris_Prime、Kratogen_TA 和 Templars 用作合法 Java 正确性基准，同次源码交给 JDT 与 javac 比较四组绑定，并记录前后指纹。

## Rust 和开发检查接口

`AnalysisRuntime::new` 接收配置根和事件接收者。`install`、`import` 和 `installed` 维护固定依赖集合，`start` 返回实例标识，`request` 按该标识交付分析请求，`close` 释放单实例，`shutdown` 等待所有实例结束。

```text
cargo build --manifest-path src-tauri/Cargo.toml -p pyxis-java-analysis --example java-analysis
src-tauri/target/debug/examples/java-analysis <status|install|import|remove|run> input.json
```

输入包含 `configRoot`；`run` 追加 `java`，`import` 追加 `archive`。`run` 按行读取 JSON 请求并返回相同请求编号，标准输入 EOF 触发实例关闭。诊断原文保存在配置目录的所属实例日志。

协议版本为 4，操作包括 `hello`、`parse`、`open`、`analyze`、`update`、`editorUpdate`、`inspect`、`assist`、`configure`、`query`、`close` 和 `shutdown`。Rust `AnalysisRequest`、`AnalysisResponse`、`FileChange` 与 Java `Protocol.Request`、`Protocol.Response` 提供两端类型化接口。源码位置采用 UTF-16 半开区间，项目更新须匹配 `expectedRevision`，文档版本须递增。

`assist` 接纳 `complete`、`signature`、`imports`、`rename` 和 `validate`。候选与签名来自当前 WorkingCopy，导入歧义返回候选类型，重命名返回冲突或带文档版本的范围修改及文件目标。代码编辑器预览后共同接纳草稿，整批保存经正式项目队列提交，整批撤销恢复文本与文件身份。

代码编辑器首次打开正式源码根内的 Java 文件后后台建立所属项目，`java_editor` 从调用窗口取得 Mod 身份并交付启动、同步、查询与关闭。`editorUpdate` 首次提交全文，后续提交有序且不重叠的 UTF-16 范围修改；`previousFile` 交付改名前身份。`inspect` 按 `document`、`hover`、`declaration`、`references` 和 `source` 分别交付大纲与诊断、签名、声明位置、引用位置和当前快照源码。悬停与源码读取复用缓存，原始全文只在明确交接边界生成。

`open` 建立私有源码快照及 WorkingCopy。`update` 支持 `add`、`replace`、`delete` 和 `move`，单批多个文件先核验后共同接纳；来源目录保持不变。`configure` 接纳完整依赖 JAR 列表、Java 路径和语言级别，并推进项目版本。每个分析版本的 AST 与声明引用索引由查询复用。

Rust 结果通过 `protocol::AnalysisResult` 区分握手、语法、项目、查询与释放；`QueryResult` 交付绑定、类型、常量、参数及声明引用位置。每个位置包含文件版本，查询结果同时保留项目和分析版本。错误保留稳定码、Java 原因、项目、文件和位置。应用服务的 `request` 接收 `AnalysisRequest`，返回 `AnalysisResponse`。

```json
{"id":1,"op":"open","project":"orbit","sources":["D:/example/src"],"classpath":[],"javaHome":"D:/Starsector/jre","language":"17"}
{"id":2,"op":"update","project":"orbit","expectedRevision":1,"files":[{"action":"add","file":"D:/example/src/Orbit.java","source":"class Orbit {}","version":1}]}
{"id":3,"op":"query","project":"orbit","revision":2,"file":"D:/example/src/Orbit.java","offset":6}
{"id":4,"op":"configure","project":"orbit","expectedRevision":2,"classpath":[],"javaHome":"D:/Starsector/jre","language":"17"}
{"id":5,"op":"close","project":"orbit"}
```

`move` 同时提交 `file`、`target`、移动后的完整 `source` 和递增 `version`；`delete` 提交 `file` 与递增 `version`。同批每个源文件出现一次，新增和移动目标各自唯一。`configure` 刷新外部 JAR，支持同一路径内容替换。

验收通过 `--output <report.json>` 预留独占 JSON、Markdown 与命令目录，默认在构建输出的 reports 中分配本次运行目录。性能对照采用当前宿主、相同输入的增量与完整分析，默认预热 2 次、正式 30 次，`--warmup` 与 `--rounds` 交付实际采样数量。统计和轮换顺序消费共同工具，报告保存原始样本、指纹、中位数、P95、内存及释放结果。

## 下载与资源

`versions.json` 集中维护协议、自有宿主、Java 运行要求、默认语言和 JDT 版本。Rust 构建生成同模块常量，Java 构建将这些值交付 Maven、宿主配置及包清单。

27 个第三方 JAR 从固定 Maven Central HTTPS 地址直接下载，逐文件校验大小和 SHA-256。`dependencies.lock.json` 保留 Maven 坐标、许可证条目和 Java 字节码信息；其中 JDT 版本占位符由构建入口消费 `versions.json` 解析；原始 JAR 保留发布许可证。

自有宿主与第三方依赖保持独立交付，Rust 启动前核对完整匹配关系。依赖安装采用文件锁、暂存目录和最后写入的完成清单，支持中断后的重新安装；独立构建同时生成离线依赖 ZIP。

## 设置中的组件管理

设置页的 Java 分析卡片位于配置文件和性能调试之间。卡片提供安装状态、JDT 版本、下载与暂存大小、安装路径、下载取消与重试、离线导入、检查并修复、环境自检、停止分析和移除。安装和日志目录通过正式系统打开能力交付。

`ComponentManagement` 持有 FIFO 队列、当前操作、进度和订阅。相同动作复用原队列项，每项拥有自己的取消控制与完成回执；页面释放订阅后队列继续执行。命令等待所属队列项的最终回执，状态通道独立交付当前进度。依赖变更在执行时核对分析已停止，应用关闭先取消并等待管理队列，再释放分析实例。

下载在 Java 模块内使用 reqwest 0.13.5、系统 TLS、系统代理及 Tokio 1.54.1。连接超时为 20 秒，单文件请求超时为 180 秒；等待网络时每 100 ms 接纳取消。完整 JAR 核对大小及 SHA-256 后取得正式暂存身份，未完成文件使用 `.part`；重试复核并复用有效文件。下载和导入共用完整清单核验与发布。

Java 路径由实际游戏目录自动提供，手动选择先验证 Java 17，再经完整设置保存、镜像和重置流程交付 `javaExecutable`。保存的手动路径对下次会话启动及自检生效。环境自检建立独立 JVM，握手后解析中性小样本，等待进程与读取线程结束并清理工作区。移除保留路径设置和诊断日志。

管理验收命令：

```powershell
$env:JAVA_ANALYSIS_TEST_JAVA = '<游戏根>/jre/bin/java.exe'
$env:JAVA_ANALYSIS_TEST_JAVA_OTHER = '<其它版本 JDK>/bin/java.exe'
cargo test --manifest-path src-tauri/Cargo.toml -p pyxis-ad-astra management_subscriptions_refresh_failure_and_closed_state
cargo test --manifest-path src-tauri/Cargo.toml -p pyxis-ad-astra queued_component_operations_run_fifo_and_cancel_uses_the_owned_operation
cargo test --manifest-path src-tauri/Cargo.toml -p pyxis-ad-astra live_management_install_repair_selfcheck_stop_remove_and_release -- --ignored --nocapture
npm run test:browser -- --suite java-analysis --url <已启动的浏览器验收地址>
```
