# 文件编辑器

## 定义

文件编辑器模块在独立窗口提供已授权文本文件的编辑与错误恢复。

## 参考

### 拥有

- `src-tauri/src/commands/file_editor.rs`：文件编辑 command 边界。
- `src-tauri/src/services/file_editor.rs`：后端编辑 service，消费 IO 路径授权并交付文本读写。
- `src/app/FileEditorContent.vue`：窗口内容，拥有行号槽、文本域、快捷键与外部文本呈现。
- `src/app/composables/editors/use-file-editor-view-model.ts`：编辑 ViewModel，拥有文本 Draft Session、加载、保存、undo/redo 与行列聚焦。
- `src/orchestrators/file-editor-window.orchestrator.ts`：从正式回执及变更集提取所属路径的完整文本。
- `src/services/files.service.ts`：文本读取、身份交接、保存与转码的 IPC 参数装配。
- `src/windows/file-editor.window.ts`：消费完整文件请求并交付常规与恢复模式窗口身份。

### 消费

- `src-tauri/src/domain/entity_definitions.rs`：八种实体的目录、后缀、ID 字段及规格、表格关联登记。
- `src-tauri/src/models/file_editor.rs`：文本读取、保存、转码与身份请求协议。
- `src-tauri/src/parsers/preserve_json.rs`：文本 ID 字段范围定位与替换。
- `src-tauri/src/services/project/query/entity_targets.rs`：实际编辑目标、身份意图及正式版本范围。
- `src-tauri/src/services/project/session.rs`：会话打开、关闭、内容更新与内部登记及就绪访问能力交付。
- `src-tauri/src/services/project/write/entity_write.rs`：已识别实体文本的身份及关联写入。
- `src/app/composables/use-app-feedback.ts`：窗口反馈的提供与消费入口。
- `src/app/composables/use-context-menu.ts`：窗口菜单状态、目标操作、事件生命周期与业务根登记。
- `src/app/composables/use-edit-target-draft-session.ts`：完整目标快照、读取票据、保存 Promise 与接纳上下文。
- `src/app/composables/use-field-input-actions.ts`：所属输入集合登记、活动输入提交与释放。
- `src/app/composables/use-managed-window-requests.ts`：组件作用域内请求接纳及释放适配。
- `src/app/composables/use-snapshot-history.ts`：目标与基线代次绑定的文本和画布快照历史。
- `src/app/composables/use-window-close-state.ts`：窗口内容关闭登记及操作锁。
- `src/app/composables/use-window-shortcuts.ts`：统一窗口按键监听、菜单优先、关闭屏蔽及卸载释放。
- `src/domain/project/entity-versions.ts`：保存目标版本捕获与关联表凭据交接。
- `src/orchestrators/project-sync.orchestrator.ts`：窗口内保存消费过程和内容维护者交接。
- `src/orchestrators/window-identity.orchestrator.ts`：正式文件身份预约及窗口交接。
- `src/services/window.service.ts`：窗口 command 的类型化签名与参数装配。
- `src/shared/types/file-editor.types.ts`：文本读取、保存、转码与身份请求协议。
- `src/shared/types/write-commit.types.ts`：公共保存回执、提交同步、行键映射与正式内容交付。
- `src/stores/project-sync.store.ts`：当前待办、错误和项目等待状态。
- `src/stores/save-command.store.ts`：文档保存句柄、进行中动作、等待与关闭交接登记。
- `src/stores/settings.store.ts`：settings 运行态，只持状态、setter 与派生值；初始快照经统一初始化入口注入。
- `src/windows/current.window.ts`：当前窗口生命周期，提供关闭请求、关闭监听、最小化、最大化、拖拽、重载与显示。
- `src/windows/managed.window.ts`：请求交付，等待所属请求的终结回执。
- `src/windows/window-context.window.ts`：只读上下文、请求监听接纳及上下文版本的前端运行态。

### 装配

- `src/app/FileEditorApp.vue`：窗口根，装配唯一窗口壳与文件编辑器内容。
- `src/app/app-feedback-assembly.ts`：授权错误位置的文件打开、转码和保存回执交接。

## 边界

- 关闭守卫消费草稿、输入和保存等待，窗口请求层拥有复用与聚焦上下文。
- 后端拥有路径、父链与文本读写授权，反馈层消费结构化 location 和恢复目标。
- 常规窗口以 session、Mod 根和 path 为身份，恢复窗口消费无 session 的授权 recovery 目标。
- 恢复保存消费无 session 能力并更新实际受影响会话正式内容，其工具历史保持恢复模式语义。
- 文件浏览器交付内容判定后的正式打开目标，文本窗口拥有所属草稿、历史与保存。
- 文本 ViewModel 拥有 Draft Session、读取、保存、外部文本暂存和行列定位。
- 文本撤销栈归编辑会话原语，组件承载文本输入与快捷键。
- 普通文本保存作用于当前文件，已识别规格交由正式实体身份事务协调关联文件。
- 转码能力按用户选择的源编码解码，receipt 经正式提交接纳。

## 链路

### 打开常规编辑窗口

1. 业务调用点以 `sessionId + modRoot + path` 发起窗口请求。
2. 窗口请求组装身份、标题与上下文并打开 managed window。
3. 窗口请求初始化文本 Draft Session；首次打开加载文件，重复打开等待保存后刷新磁盘文本并保留未保存草稿。
4. 按目标行列滚动并聚焦文本域。

### 编辑与保存

1. 用户在文本域输入，文本 Draft Session 记录 dirty。
2. 用户点击保存或 Ctrl+S 进入保存编排。
3. 保存经文件 service 到后端校验并写盘。
4. 会话以实际提交文本和返回版本接纳基线，保留后续输入与文本历史。
5. 完整 receipt 进入统一接纳入口，按 ready 或 `pending` 处理会话正式内容并发送提交通知。
6. 同步失败呈现已写盘状态与同步错误，等待交接结束。

### 外部文本同步

1. 统一提交事件按实际 after 路径和快照投影当前文件文本。
2. dirty 窗口将文本暂存为外部版本并呈现提示。
3. 用户确认载入后替换文本域内容。

### 错误恢复编辑

1. 错误提示与概览列表消费窗口反馈统一交付的文件动作。
2. 以 recovery 模式打开无 session 窗口，身份为 `modRoot + path`。
3. 保存走无 session 文件写入能力并仅写当前文件。
4. 恢复 receipt 以 nullable session 身份同步实际受影响的已登记会话，工具历史保持所属模式。

### 转码为 UTF-8

1. 反馈层仅在 `text.invalid_utf8` 且目标属于授权会话或恢复目标时提供独立转码动作。
2. 用户选择源编码，后端按所选 GBK／GB18030 或 Windows-1252 解码。
3. 后端重新读取磁盘内容，已有效的 UTF-8 文件保持当前字节并交付可直接打开的信息，所选编码完整解码后才允许写盘。
4. 解码成功经 changeset 链路写回，所属 receipt 进入统一提交接纳与窗口通知。

## 规范

- 跟随身份必须区分原新路径变化与同路径 ID 变化，确认说明文本保留及身份映射；外部载入交付当前文件的实际路径。
- 局部文件身份必须在内容缺省 ID 时从实际文件名推断，原始文本保存保留局部内容；文本保存按原路径写入提交文本，严禁改名或联动关联记录，保存后的身份变化按外部修改接纳。
- 保存期间文本域必须保持可编辑，后续文本按实际写盘基线计算 dirty；本地保存保留文本快照历史。
- 保存解析失败必须保留原文并定位行列；未完成文本跟随改名时保持待交接身份，文本可解析后接纳新路径、ID 与基线。
- 外部文本载入必须在 dirty 时确认放弃，确认绑定发起时的完整目标；接纳后清理文本历史。
- 可靠的纯文本路径改名必须交接完整窗口目标，确认跟随保留文本草稿及所属历史，当前读取成功接纳已修复的初载来源。
- 已识别规格读取必须共同返回文本、正式 `EntityTargetSnapshot` 与所属版本范围；文本修改 ID 消费结构化保存的同一身份事务。
- 恢复入口只允许消费后端结构化 recovery 目标；恢复保存只允许写当前文件，必须使用无 session 能力，严禁登记文件历史。
- 文本事务必须保留提交原文；身份字段归一与外部跟随只允许修改解析定位的 ID 值范围。
- 文本内容变化必须只经所属保存事件消费过程处理；回执文本、目标与所需实体凭据充分时直接接纳，信息不足时读取一次。
- 文本域必须完整保留换行与空白，严禁规范化输入内容；转码按用户选择的源编码执行，严禁自动探测。
- 文本窗口必须登记所属文件及实体关联的版本范围；联合准备消费原文输入、保存等待与正式文本保存，错误保留原文。
- 窗口复用必须经正式请求接纳最新行列并重读文件，文本、历史和 dirty 继续由原文本会话拥有；磁盘差异经外部版本接纳流程处理。
- 错误恢复窗口必须以 nullable session 身份发布完整提交结果；恢复入口消费后端返回的实际关联会话集合。
