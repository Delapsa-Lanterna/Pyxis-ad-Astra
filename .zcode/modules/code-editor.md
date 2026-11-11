# 代码编辑器

## 定义

代码编辑器模块在每个 Mod 或 Core 项目的独立窗口中维护项目浏览、多文件标签、文本编辑和文档寿命。

## 参考

### 拥有

- `src-tauri/src/commands/code_editor.rs`：文件打开、订阅和接纳回执命令。
- `src-tauri/src/services/code_editor.rs`：按窗口持有的文件 FIFO 请求和完成回执。
- `src/app/components/code-editor/`：文件标签、文本输入和状态区域。
- `src/app/composables/code-editor/`：文档集合、保存参与者、同步和关闭。
- `src/domain/code-editor/`：文件标签名称投影。
- `src/services/code-editor.service.ts`：文件请求和接收的类型化传输。

### 消费

- `src-tauri/src/errors.rs`：结构化文件错误。
- `src-tauri/src/io/mod.rs`：所属项目目录的规范路径及边界。
- `src-tauri/src/models/code_editor.rs`：文件打开、交付及结果协议。
- `src-tauri/src/models/window.rs`：所属 Mod 窗口身份和结构化输入。
- `src-tauri/src/services/project/session.rs`：正式就绪会话授权。
- `src-tauri/src/services/project/session/references.rs`：已发布可引用会话顺序和修订。
- `src-tauri/src/services/windows.rs`：窗口创建、复用和请求接纳。
- `src/app/composables/file-browser/use-directory-reads.ts`：目录读取合并、优先级及撤销。
- `src/app/composables/use-app-feedback.ts`：文件错误和关闭选择。
- `src/app/composables/use-edit-target-draft-session.ts`：独立文件草稿和基线。
- `src/app/composables/use-field-input-actions.ts`：绑定文档身份的外部文本载入确认。
- `src/app/composables/use-managed-window-requests.ts`：窗口就绪交接。
- `src/app/composables/use-window-close-state.ts`：窗口关闭保护。
- `src/app/composables/use-window-shortcuts.ts`：保存和历史快捷键。
- `src/domain/file-browser/file-tree.ts`：目录排序、浏览树、搜索树及目录失效投影。
- `src/domain/project-sync/committed-text.ts`：正式回执中的所属文件文本。
- `src/orchestrators/project-sync.orchestrator.ts`：保存接纳、外部更新及所属项目队列交接等待。
- `src/orchestrators/window-identity.orchestrator.ts`：整批文本提交的目标预约和释放。
- `src/services/file-browser.service.ts`：正式目录、文件名搜索及文本内容判定。
- `src/services/java-analysis.service.ts`：所属窗口的分析启动、草稿交接、查询与关闭。
- `src/services/text-editor.service.ts`：正式文本读取与保存。
- `src/shared/lib/errors.ts`：原始错误和位置转换。
- `src/shared/lib/paths.ts`：文件路径比较及范围。
- `src/shared/runtime/read-request.ts`：读取寿命等待。
- `src/shared/runtime/text-document.ts`：不可变文本、原始换行、历史、当前文件搜索及按文件启用的语言能力。
- `src/shared/types/code-editor.types.ts`：多文件请求和单文件结果。
- `src/shared/ui/TextEditorSurface.vue`：共享活动文本视图与滚动交接。
- `src/stores/save-command.store.ts`：多文档保存与编辑目标登记。
- `src/stores/settings.store.ts`：正式历史容量。
- `src/windows/current.window.ts`：窗口关闭能力。
- `src/windows/window-context.window.ts`：所属 Mod 的只读窗口上下文。

### 装配

- `src-tauri/src/lib.rs`：命令登记及窗口销毁后的队列释放。
- `src/app/CodeEditorApp.vue`：窗口壳与编辑器内容装配。
- `src/main.ts`：代码编辑器窗口的按需根装载。

## 边界

- 一个窗口属于一个正式 Mod 或 Core 会话，文件路径归窗口内文档。
- 后端文件队列保持顺序，每个请求独占完成回执。
- 文档拥有基线、草稿、历史、外部版本及视图位置。
- 活动文本视图共享 DOM，全部标签的文档保留独立寿命。
- 保存复用正式项目执行及参与者，写盘回执交给原文档。
- 文件读取和保存路径由正式授权边界交付。
- 窗口 composable 装配请求接纳与关闭参与者，文本组件持有输入、选择和滚动状态。
- 分析适配拥有后台准备、草稿交接及结果接纳，引用源码来自所属项目快照并以只读文档展示。

## 链路

### 文件打开

1. Mod 或 Core 导航的代码入口交付所属身份及空文件列表，窗口机制创建或复用所属窗口。
2. 文件请求进入所属 FIFO，编辑器顺序读取各文件，整批结束后激活最后一个成功文件。
3. 同路径文件定位原标签，新路径建立独立文档，逐文件交回结果。
4. 标签切换恢复内存文本、选择和滚动。
5. 项目树按展开读取当前目录和可引用源码，双击或 Enter 判定文本并交付打开队列；引用源码消费分析快照。

### 保存与关闭

1. 文档登记独立保存参与者和编辑目标集合。
2. 当前保存或保存全部消费所属文档的保存任务。
3. 正式更新按文件接纳或暂存外部基线，改名更新文档身份。
4. 标签关闭等待保存并确认未保存草稿，窗口关闭覆盖全部文档。
5. 窗口销毁释放队列、文档和监听并结束未完成文件请求。

## 规范

- 已载入标签切换必须只使用内存文档及视图状态。
- 项目树持有所属窗口的目录、搜索、选择和滚动，来源消费正式会话与引用集合；窗口关闭结束本次状态。
- 窗口及普通文本打开必须保持分析惰性，首次打开正式源码根内的 Java 文件后准备 JVM；源码根外的 Java 文件明确显示分析范围。
- 打开文件必须经过 FIFO，单文件失败必须交付所属错误并继续同批其它文件。
- 同路径再次打开必须复用原文档和历史并接纳请求位置。
- 文件保存必须捕获原目标，保存期间的新输入必须继续保留。
- 改名接纳必须更新标签、文档和编辑目标，窗口身份必须保持所属 Mod。
- 文本输入必须保留未修改范围的原始换行和空白，输入法组词只登记一次提交历史。
- Java 文件按文档持有高亮、缩进与折叠，搜索替换限定当前文件；标签切换保留所属查询及折叠状态。
- 单行超过 20,000 个 UTF-16 字符的 Java 文件必须提示轻量显示并暂停语法功能，内容恢复后重新启用。
- 保存捕获必须等待组词提交并分隔前后输入历史，保留较早历史与保存期间的新文本。
- 标签关闭必须等待所属保存，dirty 选择必须绑定所属文档。
- 文档释放必须结束历史、读取与保存登记，窗口释放必须结束全部待交付回执。
- Java 草稿必须在组词完成及停笔 300 ms 后串行提交范围修改，定位查询先等待待交付内容，结果只接纳对应内容与路径的快照。
- 分析刷新优先交付活动文件；同项目版本复用已有后台投影，语义变化后按新版本接纳全部所属文件结果。
- 引用源码标签必须同时禁止输入、撤销修改与保存登记；关闭窗口必须等待所属请求并释放分析项目。
- 多文件修改必须先核对预览项目版本及全部草稿，再共同接纳；关联保存及撤销覆盖同一批文件，保存回执保留后续输入。
- 补全候选与参数签名按当前内容和光标接纳，导入歧义由明确选择交付，重命名先展示范围与冲突。
