# 保存提交

## 定义

保存提交模块提供写盘事务、提交回执与指定提交的投影恢复。

## 参考

### 拥有

- `src-tauri/src/services/write_transactions.rs`：根租约、版本复核、提交完成及回放调度。
- `src-tauri/src/services/write_transactions/committed.rs`：根提交序号、会话投影结果与恢复记录。

### 消费

- `src-tauri/src/io/file_changes.rs`：同根 FIFO 租约和实际 changeset 应用。
- `src-tauri/src/models/write_commit.rs`：公共保存回执、提交投影、行键映射与 JSON 写入参数。
- `src-tauri/src/services/file_history.rs`：历史登记、查询、清空及回放状态交接。
- `src-tauri/src/services/project/mod.rs`：受影响会话、目标版本及正式投影构造。
- `src/shared/types/write-commit.types.ts`：保存回执、提交恢复请求、行键映射与 JSON 写入契约。

### 装配

- `src-tauri/src/commands/project_sync.rs`：指定提交恢复的 command 交接。
- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。
- `src/orchestrators/project-sync.orchestrator.ts`：前端提交接纳、恢复重试及窗口通知。

## 边界

- 业务保存入口拥有输入提交、草稿捕获、所属写入与实际基线接纳。
- 保存提交拥有根租约、提交序号、提交记录和对应恢复结果。
- 历史模块拥有双栈、历史 revision 与 changeset 登记。
- 同根事务持有 IO 租约，按顺序完成业务写入、历史登记和投影构造。
- 窗口内同步状态、缓存失效与通知归项目同步。

## 链路

### 保存提交

1. 业务 command 取得同根租约并核对会话与目标版本。
2. 所属写入能力构造并应用 changeset，历史模块登记结果。
3. 提交运行态分配提交序号并构造受影响会话的正式投影。
4. 回执交付实际版本、历史摘要和 ready 或 pending 会话结果。

### 指定提交恢复

1. 项目同步 command 交付所属 session、Mod 根与提交 ID。
2. 事务取得所属根租约，读取正式提交记录。
3. pending 记录按保存的 changeset 恢复投影，ready 记录交付已有结果。
4. 会话关闭时释放所属提交恢复记录。

## 规范

- JSON 写入参数必须保留后端 false 与空确认列表的默认语义，正式保存入口必须显式交付当前设置。
- 保存期间的新编辑必须归所属草稿与历史，提交回执必须表达实际写盘结果。
- 历史双栈与 revision 只允许由文件历史模块修改，事务必须消费所属登记和回放入口。
- 同根提交必须消费 FIFO 租约，目标版本必须在实际写盘前核对。
- 指定提交恢复必须消费原 session、Mod 根与提交 ID，严禁再次执行业务文件写入。
- 提交投影必须按 ready 与 pending 的同一扁平协议交付，错误必须消费 ErrorDiagnostic。
- 磁盘与历史完成后的投影失败必须保留原提交记录，成功恢复必须交付可重复接纳的结果。

## 陷阱

- 严禁以通知重试触发业务保存，重复写盘会重复登记历史。
- 严禁在事务内修改前端草稿，当前编辑必须由所属编辑会话接纳。
- 严禁用新 changeset 替换待恢复提交，恢复必须消费原实际写盘范围。
