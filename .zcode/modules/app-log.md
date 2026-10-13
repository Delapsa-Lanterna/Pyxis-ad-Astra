# 应用日志

## 定义

应用日志模块提供工具日志的追加、状态、维护与失败隔离能力。

## 参考

`src-tauri/src/commands/app_log.rs`：日志 command 主归属。
`src-tauri/src/diagnostics.rs`：后端内部诊断 sink 主归属。
`src-tauri/src/services/app_log.rs`：日志路径、级别、渲染及轮转。
`src/services/app-log.service.ts`：四个 command 的签名与参数装配、best-effort 和性能 sink 接线。
`src/shared/lib/log-fields.ts`：结构化上下文组装主归属。
`src/shared/types/app-log.types.ts`：日志 wire 模型。

## 边界

- best-effort 在日志 owner 内结束失败，向业务调用方保留原动作结果。
- 各窗口启动装配性能 sink，pagehide 释放注册；业务调用方提供稳定码和结构化上下文。
- 日志能力拥有条目追加、状态、打开、清空、轮转及失败隔离。
- 目录、级别、轮转大小和备份份数来自已保存 settings，过滤与实际路径解析归后端。
- 设置 ViewModel 消费维护能力，日志写入目标是工具日志文件。
- 默认目录由后端建立，自定义目录以已存在且可写的目录为输入。

## 链路

### 日志追加

1. 业务动作或反馈投影日志条目。
2. `recordLogBestEffort` 调用 `append_app_log`。
3. Rust 按已保存设置判定级别、目录、轮转大小和备份份数。
4. 日志 owner 取得写锁，按阈值轮转并渲染追加条目。

### 性能装配

1. main 在业务挂载前调用 `startPerformanceLogSink`。
2. 性能原语调用注册的日志能力。
3. 窗口 pagehide 释放所属 sink。

### 日志维护

1. 设置页动作读取状态或确认清空。
2. 所属日志能力调用状态、打开或清空 command。
3. 返回实际路径、字节数或动作结果。

## 规范

- Mod session 生命周期日志必须由正式打开与移除编排记录，包含 Mod 和 session。
- 内部降级错误必须经 diagnostics sink 记录；日志失败严禁传播到业务或产生递归。
- 动作日志必须采用正式稳定码：app.started/exited、directory.scanned/unrecognized、mod.session_opened/closed、mod.already_loaded/removed/created、tables.csv_saved/row_created/row_deleted/undo_applied/redo_applied、workspace.refreshed/closed、editor.file_opened/file_saved/window_opened/spec_saved、history.replayed、settings.saved；settings.saved 必须为 DEBUG，editor.draft_snapshot_invalid 必须为 warning。
- 敏感信息进入日志前必须脱敏，应用启动与退出必须携带版本，Mod session 生命周期必须携带 `modRoot` 与 `sessionId`。
- 日志 message 只允许原始诊断或英文短语；用户文案必须由反馈投影。
- 日志备份必须按 `.log.1` 至 `.log.N` 保留最新 `logBackupCount` 份，默认必须为 1，整数范围必须为 1–20；轮转必须按编号降序移动，份数收缩必须在下次轮转清理超额备份。
- 日志备份清理必须只消费固定日志名和规范正整数后缀；文件操作失败必须保留实际路径并交给日志错误入口。
- 日志文件名必须固定，追加前达到 `logRotationSizeMiB` 阈值时必须轮转；阈值默认必须为 5 MiB，整数范围必须为 1–1024。
- 日志条目必须分别携带 code、message、path、line 和字符串 fields；command 和 action 必须分别消费。
- 日志稳定码必须采用前端域动作或后端正式错误码；fields 必须在 path/line 后按键序渲染，组装时必须丢弃空值，全空必须为 `null`。
- 日志追加、轮转与清空必须由同一后端写锁串行协调。
- 时间必须按后端写入时的本地时间渲染，fields 必须按键排序并清洗 CR/LF/TAB。
- 时间戳必须采用 YYYY-MM-DD HH:mm:ss.SSS，清空日志必须保留空日志文件并返回实际状态。
- 默认 INFO 必须过滤 DEBUG，性能条目必须采用 perf 码及 DEBUG。

## 陷阱

- 从当前页面推导目录会让同一日志动作的目标随导航变化。
- 按日期或会话改换日志文件名会使状态、轮转与清空定位不同文件。
- 模块导入时注册性能 sink 会让窗口释放无法准确撤销所属实例。
