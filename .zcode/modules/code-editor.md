# 代码编辑器

## 定义

代码编辑器模块在每个 Mod 或 Core 项目的独立窗口中装配项目浏览、文本文件编辑和 Java 能力。

## 参考

### 拥有

- `src-tauri/src/commands/code_editor.rs`：文件打开、订阅和接纳回执命令。
- `src-tauri/src/services/code_editor.rs`：按窗口持有的文件 FIFO 请求和完成回执。
- `src-tauri/src/services/code_editor/`：正式项目及可引用来源分组查询。
- `src/app/components/code-editor/`：项目工作区布局、来源分组与区域操作。
- `src/app/composables/code-editor/`：所属文件请求、来源浏览实例、Java 和窗口关闭装配。
- `src/services/code-editor.service.ts`：文件请求和接收的类型化传输。

### 消费

- `src-tauri/src/errors.rs`：结构化文件错误。
- `src-tauri/src/io/mod.rs`：所属项目目录的规范路径及边界。
- `src-tauri/src/models/code_editor.rs`：文件打开、交付及结果协议。
- `src-tauri/src/models/window.rs`：所属 Mod 窗口身份和结构化输入。
- `src-tauri/src/services/java_analysis/inputs.rs`：实际分析源码根描述。
- `src-tauri/src/services/project/session.rs`：正式就绪会话授权。
- `src-tauri/src/services/project/session/references.rs`：已发布可引用会话顺序和修订。
- `src-tauri/src/services/windows.rs`：窗口创建、复用和请求接纳。
- `src/app/components/file-browser/file-tree-renderers.ts`：目录、文件及受限条目的图标和读取状态展示。
- `src/app/components/java-analysis/`：Java 大纲、诊断、引用和修改预览。
- `src/app/components/text-file-editing/`：文件标签及排序交互。
- `src/app/composables/file-browser/use-file-browser.ts`：窗口独立的浏览状态、查询及失效接纳。
- `src/app/composables/java-analysis/`：草稿交接、查询接纳及 Java 界面扩展。
- `src/app/composables/text-file-editing/`：文件集合、关联修改、保存与释放。
- `src/app/composables/use-app-feedback.ts`：文件错误和关闭选择。
- `src/app/composables/use-managed-window-requests.ts`：窗口就绪交接。
- `src/app/composables/use-window-close-state.ts`：窗口关闭保护。
- `src/app/composables/use-window-shortcuts.ts`：保存和历史快捷键。
- `src/orchestrators/project-sync.orchestrator.ts`：来源变化及保存后的分析刷新接线。
- `src/shared/lib/errors.ts`：原始错误和位置转换。
- `src/shared/lib/paths.ts`：文件路径比较及范围。
- `src/shared/types/code-editor.types.ts`：多文件请求和单文件结果。
- `src/shared/types/text-file-editing.types.ts`：文件打开与逐文件结果。
- `src/shared/ui/TextEditorSurface.vue`：共享活动文本视图与滚动交接。
- `src/stores/file-browser.store.ts`：浏览实例状态工厂。
- `src/windows/current.window.ts`：窗口关闭能力。
- `src/windows/window-context.window.ts`：所属 Mod 的只读窗口上下文。

### 装配

- `src-tauri/src/lib.rs`：命令登记及窗口销毁后的队列释放。
- `src/app/CodeEditorApp.vue`：窗口壳与编辑器内容装配。
- `src/main.ts`：代码编辑器窗口的按需根装载。

## 边界

- 窗口身份属于正式 Mod 或 Core 会话，工作区布局及来源分组归代码编辑器。
- 浏览、大纲及结果区域的展开与尺寸状态随所属窗口存活，区域调整保留活动文本视图。
- 原生打开队列持有交付顺序与逐请求完成回执，文本文件编辑持有实际文件打开和标签寿命。
- 文件浏览器持有各来源的浏览实例，窗口装配持有来源顺序、只读身份和分组展开。
- 文本文件编辑交付草稿、标签和保存动作，Java 分析交付语义结果及修改方案。
- 跨文件定位由窗口连接文件打开与 Java 快照读取，引用文件以只读快照接纳。
- 窗口关闭共同等待文件请求、保存、浏览打开与分析请求完成。

## 链路

### 进入与文件打开

1. 导航捕获项目身份，经正式窗口能力创建或聚焦所属窗口。
2. 来源查询取得当前根、正式引用及 Java 源码根，工作区为各来源建立浏览实例。
3. 当前文件交给文本文件编辑打开队列，引用文件经 Java 快照读取后交付只读标签。
4. 首次打开所属源码根内的 Java 文件后启动分析，交付当前草稿和查询扩展。
5. 原生文件请求等待文件打开结果，按所属操作键交还完成回执。

### 修改与关闭

1. Java 修改方案经窗口装配交付文本文件编辑，验证预览后共同接纳草稿。
2. 文件保存和标签关闭消费文本文件编辑的正式动作及影响确认。
3. 窗口关闭等待所属队列，释放浏览实例、文件集合和分析项目。
4. 原生销毁结束剩余文件回执与 Java 项目登记。

## 规范

- 一个正式项目必须复用一个代码窗口，重复进入保留当前文件与阅读状态。
- 原生打开请求必须按接纳顺序交付，每项持有所属结果。
- 来源分组必须消费正式引用顺序和实际分析范围。
- 当前来源可编辑文件与引用只读快照必须通过所属明确动作交付。
- 空窗口和普通文本保持分析惰性，所属 Java 文件首次打开后启动分析。
- 源码根外的 Java 文件必须展示实际分析范围。
- 窗口释放必须结束本次浏览、文本、分析和文件请求寿命。
