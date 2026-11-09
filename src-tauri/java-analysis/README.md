# Java 分析

Java 分析模块提供 Java 17 语法与项目语义分析、固定依赖安装及实例寿命管理。Rust 包名为 `pyxis-java-analysis`，Java 包名为 `com.delapsalanterna.pyxis.javaanalysis`。

## 目录与运行态

- `src/`：依赖、协议、进程、配置目录和分析运行态。
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

## 构建与验收

普通主程序构建通过 Cargo 路径依赖使用已准备的自有资源。完整 JDK 17 和 Maven 用于独立重建；`AST_JDK` 或 `JAVA_HOME` 指定开发 JDK，`AST_GAME` 或 `--game` 指定真实验收游戏根。

在仓库根运行：

```powershell
npm run build:java-analysis -- --dry-run
npm run build:java-analysis
npm run check:java-analysis
npm run test:java-analysis -- --game D:/Starsector
npm run test:java-analysis -- --game D:/Starsector --download
$env:JAVA_ANALYSIS_TEST_JAVA = 'D:/Starsector/jre/bin/java.exe'
cargo test --manifest-path src-tauri/Cargo.toml -p pyxis-java-analysis --test runtime -- --include-ignored
```

构建输出位于 `src-tauri/target/java-analysis/`。Java 源码使用 google-java-format 1.24.0，Rust 和 Node.js 代码沿用主项目格式及检查入口。Java 构建重新核对第三方 JAR 哈希，依赖集合由锁文件决定。

专用 CI 任务在 JDK 17 下重建和测试宿主；真实 Mod 校验接受外部游戏目录。Polaris_Prime、Kratogen_TA 和 Templars 用作合法 Java 正确性基准，同次源码交给 JDT 与 javac 比较四组绑定，并记录前后指纹。

## Rust 和命令行接口

`AnalysisRuntime::new` 接收配置根和事件接收者。`install`、`import` 和 `installed` 维护固定依赖集合，`start` 返回实例标识，`request` 按该标识交付分析请求，`close` 释放单实例，`shutdown` 等待所有实例结束。

```text
java-analysis <status|install|import|remove|run> input.json
```

输入包含 `configRoot`；`run` 追加 `java`，`import` 追加 `archive`。`run` 按行读取 JSON 请求并返回相同请求编号，标准输入 EOF 触发实例关闭。诊断原文保存在配置目录的所属实例日志。

协议操作包括 `hello`、`parse`、`open`、`analyze`、`update`、`query`、`close` 和 `shutdown`。源码位置采用 UTF-16 半开区间，查询绑定当前 `revision`，内存更新要求每文件版本递增。源码和依赖目录通过显式项目输入交付，已打开文件的修改由 WorkingCopy 承载。

## 下载与资源

27 个第三方 JAR 从固定 Maven Central HTTPS 地址直接下载，逐文件校验大小和 SHA-256。`dependencies.lock.json` 保留 Maven 坐标、许可证条目和 Java 字节码信息；原始 JAR 保留发布许可证。

自有宿主与第三方依赖保持独立交付，Rust 启动前核对完整匹配关系。依赖安装采用文件锁、暂存目录和最后写入的完成清单，支持中断后的重新安装；独立构建同时生成离线依赖 ZIP。
