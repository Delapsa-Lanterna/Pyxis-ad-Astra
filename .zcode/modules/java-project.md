# Java 工程

## 定义

Java 工程模块维护源码与依赖输入、工程配置、同步与构建、成功产物及部署内容交付。

## 参考

### 拥有

- `src-tauri/src/commands/java_project.rs`：代码窗口身份核对与工程动作交付。
- `src-tauri/src/services/java_project.rs`：项目登记、正式动作入口及生命周期装配。
- `src-tauri/src/services/java_project/`：共同输入、Java 路径、构建、产物及所属进程寿命。
- `src/app/components/java-project/`：工程配置、构建部署、任务及产物呈现。
- `src/app/composables/java-project/`：工程动作、保存等待及同步结果接纳。
- `src/services/java-project.service.ts`：工程动作的类型化传输。

### 消费

- `src-tauri/java-analysis/src/versions.rs`：固定游戏 Java 编译目标。
- `src-tauri/src/diagnostics.rs`：任务身份、阶段、耗时及失败日志。
- `src-tauri/src/errors.rs`：原始错误与位置交付。
- `src-tauri/src/io/mod.rs`：授权路径、文本和二进制快照及文件版本。
- `src-tauri/src/models/java_project.rs`：工程设置、有效描述和任务回执。
- `src-tauri/src/models/project_session.rs`：正式项目身份与 Mod 信息。
- `src-tauri/src/parsers/tool_json.rs`：工具私有配置与自有 Gradle 模型解析。
- `src-tauri/src/services/app_settings.rs`：正式游戏目录和手动 Java 路径。
- `src-tauri/src/services/project/mod.rs`：项目就绪清单、根授权及引用来源。
- `src-tauri/src/services/project/session.rs`：正式就绪会话身份与清单。
- `src-tauri/src/services/project/session/references.rs`：已发布引用来源的正式顺序。
- `src-tauri/src/services/project/sources/roots.rs`：所属游戏根解析。
- `src-tauri/src/services/system_open.rs`：成功产物的系统定位。
- `src-tauri/src/services/windows.rs`：实际调用窗口身份。
- `src/app/composables/use-app-feedback.ts`：保存选择及错误反馈。
- `src/app/composables/use-query-read-owner.ts`：工程读取的在途接纳与作用域释放。
- `src/shared/lib/paths.ts`：项目内相对路径展示与路径范围判断。
- `src/shared/runtime/dialog.runtime.ts`：Gradle 可执行文件选择。
- `src/shared/types/java-project.types.ts`：前端工程动作与快照。
- `src/shared/ui/FieldRow.vue`：所属设置行展示。
- `src/stores/settings.store.ts`：Java 设置变化接纳。

### 装配

- `src-tauri/src/lib.rs`：命令登记及窗口释放。
- `src-tauri/src/services/app_lifecycle.rs`：应用退出前等待工程任务。
- `src-tauri/src/services/code_editor/sources.rs`：项目及引用来源消费实际源码根。
- `src-tauri/src/services/java_analysis.rs`：分析运行环境的 Java 路径消费。
- `src-tauri/src/services/java_analysis/sessions.rs`：分析会话消费共同源码、类路径与指纹。
- `src-tauri/src/services/project_save.rs`：部署内容进入项目队列、二进制事务及历史。
- `src-tauri/src/services/project_sync.rs`：会话注销前释放所属任务。
- `src/app/components/code-editor/CodeOverview.vue`：代码总览装配工程设置。
- `src/app/composables/code-editor/use-code-editor-window.ts`：保存、目录及分析结果交接。

## 边界

- 项目设置保存在工具私有目录，按实际 Mod 根隔离并恢复。
- 手动工程设置在字段输入提交后自动保存，保存串行交付，结果接纳保留正在输入的字段原文。
- 窗口关闭必须等待工程设置保存；保存失败保持窗口及输入，修正后按实际保存结果继续关闭。
- 编译模式由工程设置明确选择，手动模式独立执行 JDK 编译，Gradle 模式统一拥有安装检测、配置同步、任务参数及输出展示。
- Gradle 交付实际源码、依赖、任务与产物，分析消费有效工程输入。
- 主程序 Java 设置交付运行环境，编译目标消费版本声明。
- 同步任务归后端持有，窗口消费状态与有限输出。
- 文本编辑保留草稿与历史，配置更新通过宿主连接浏览和分析。
- 手动构建使用所选完整 JDK，在私有工作目录生成仅含编译结果的 JAR；Gradle 产物消费实际执行任务的输出。
- 成功产物绑定身份、输入和内容指纹；失败保留上一份成功产物，部署核对源产物与目标版本。
- 同步与构建共享项目任务寿命，原始输出归任务日志，窗口只持有有限尾部。
- 工程描述按正式来源失效，构建保存所属输入版本，任务阶段和诊断由任务实现统一接纳。
- 配置选择诊断与任务结果分别交付，任务结果由返回协议和持久化共同使用。
- Gradle 任务覆盖全部项目及实际任务路径、分组和说明，执行接纳有序任务与参数；Java 子项目选择只决定分析输入。

## 链路

### 工程读取与同步

1. 代码窗口交付所属身份，工程读取正式清单及私有设置。
2. 手动配置或 Gradle 模型交付实际源码、依赖及游戏加载路径。
3. 同步等待构建配置保存，以选择的 Java 运行项目 Gradle。
4. 读取脚本交付带编译目标的工程模型，成功后持久化并更新消费方。
5. 取消及关闭等待所属进程结束，释放临时工作区并保留操作日志。

## 规范

- 分析与 Gradle 必须消费同一主程序 Java 路径，手动选择接受 17 及更新版本。
- 编译目标必须消费正式版本声明，项目差异保留实际配置位置。
- Gradle 同步必须优先离线，下载由本次明确动作授权，额外 JDK 自动下载保持关闭。
- 同步结果必须复核来源版本，失败保留已接纳配置与原始原因。
- 重复同步必须合并所属在途工作，取消与关闭等待本次进程树及输出交付结束。
- 来源分组必须按项目和实际源码目录分别持有浏览实例。
- 构建必须等待项目跨窗口保存确认与交接；部署必须通过正式保存队列、目标协调和二进制文件历史。
- 构建必须复核已确认的配置身份；任务重试必须保留原动作、所选任务与下载授权。
- 并发等待者必须保留所属任务回执，回执与执行槽分别释放。
- Gradle 展示与执行必须消费同一安装解析结果，任务结果按实际任务图交付输出文件。
