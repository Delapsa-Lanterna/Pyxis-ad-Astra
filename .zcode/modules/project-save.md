# 项目保存调度

## 定义

项目保存调度模块协调完整保存请求的业务准备、排队执行与实际结果返回。

## 参考

### 拥有

- `src-tauri/src/commands/project_save.rs`：发起窗口与完整保存请求的 command 入口。
- `src-tauri/src/services/project_save.rs`：完整请求捕获、业务动作准备、执行与结果交接。

### 消费

- `src-tauri/src/models/save_action.rs`：保存请求及封闭业务动作。
- `src-tauri/src/services/config_entity.rs`：JSON 实体正式内容准备与实际写入。
- `src-tauri/src/services/file_editor.rs`：文本内容准备与实际写入。
- `src-tauri/src/services/json_file.rs`：Variant 与 Skin 文件保存及身份操作。
- `src-tauri/src/services/misc_config.rs`：已登记配置文件的实际保存与删除。
- `src-tauri/src/services/project_sync.rs`：项目队列、来源确认、恢复等待和结果发布。
- `src-tauri/src/services/write_transactions.rs`：根租约、版本核对、实际提交及文件回放。

### 装配

- `src-tauri/src/commands/mod.rs`：正式保存 command 登记。
- `src-tauri/src/services/mod.rs`：业务准备与写入能力导出。

## 边界

- 完整保存请求归发起编辑会话，项目保存调度持有捕获请求至实际执行结果返回。
- 业务内容准备归所属编辑模块，调度消费明确业务入口。
- 项目同步持有 FIFO、来源确认、失败等待与结果发布状态。
- 文件事务持有根租约、版本核对、历史及已写盘投影恢复。
- 引用来源通知消费已完成提交结果，通知诊断归正式诊断入口。

## 链路

### 保存请求

1. command 交付发起窗口及完整保存请求。
2. 调度捕获实际项目根、session 和动作原因并登记项目队列。
3. 队首工作取得执行位置并交接前序身份与版本。
4. 所属业务准备当前正式内容，事务取得根租约并核对凭据。
5. 所属业务交付实际写入结果，事务完成历史及正式投影登记。
6. 同步发布实际结果并释放队首，调度返回结果及交付引用来源更新。

## 规范

- 保存动作必须由封闭请求类型穷尽分派，具体编辑规则必须归所属业务入口。
- 保存请求必须消费捕获的根、session、修改与发起窗口，等待必须覆盖所属项目执行。
- 实际文件修改必须经正式事务入口，文件回放与来源刷新必须消费各自正式流程。
- 结果必须由实际提交决定，引用通知失败必须保留提交结果并交付诊断。
- 项目队列必须覆盖来源确认、业务准备、文件执行、失败恢复、历史及正式内容登记。
- JSON 与联合编辑准备必须由所属业务维护，调度必须直接消费正式能力导出。
