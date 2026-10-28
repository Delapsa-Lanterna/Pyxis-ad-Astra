# 后端能力与 IPC 传输

## 定义

后端能力与 IPC 传输模块提供类型化跨进程调用及能力归属契约。

## 参考

### 拥有

- `src-tauri/src/commands/mod.rs`：command 模块注册和正式命令导出。
- `src/services/application-commands.spec.ts`：应用、窗口、设置及会话的 command 参数交接验证。
- `src/services/persistence-commands.spec.ts`：跨业务写入与回放的 wire 参数交接验证。
- `src/services/reading-commands.spec.ts`：正式只读能力的传输、身份与查询结果验证。
- `src/services/session-query-invalidation.spec.ts`：全部业务查询与标准失效范围的跨入口验证。

### 消费

- `src-tauri/command-macros/`：统一命令声明、登记与执行计时接入。
- `src-tauri/src/models/mod.rs`：正式模型导出、serde 输入原语与共享去重追加函数。
- `src-tauri/src/models/project_identity.rs`：command 消费的所属 session 与 Mod 根范围契约。
- `src/shared/runtime/command-runtime.spec.ts`：传输与来源诊断验收。
- `src/shared/runtime/command.runtime.ts`：唯一原始 invoke。

### 关联

- `scripts/architecture/rules/capabilities/command-boundary.mjs`：command 调用的来源与唯一归属检查。
- `scripts/architecture/rules/capabilities/command-policy.mjs`：原生命令与保存动作的所属能力清单。
- `scripts/architecture/rules/capabilities/rust-command-functions.mjs`：commands 生产函数的命令声明检查。
- `scripts/shared/frontend-source.mjs`：词法调用、绑定与源码位置事实。

## 边界

- `AppError` 保留 command 和原始 cause，领域 action 由用户动作提供。
- `command.runtime` 拥有唯一原始 invoke 调用与透明错误包装。
- 命令详细记录由共同传输入口生成，记录请求身份、命令名和完成状态。
- 所属 service 拥有 command 参数装配，共享传输消费完整参数。
- 能力矩阵维护公开操作权限，command-policy 分别维护原生命令和保存动作归属。
- 静态检查消费共享符号来源、调用和位置事实，分别验证 command owner 与能力消费者。

## 链路

### 跨进程调用

1. 所属能力装配原生命令参数或保存动作输入。
2. 普通能力经 `invokeCommand` 交付原生命令，保存动作经 `invokeSaveCommand` 交付 `save_project` 的保存请求。
3. 成功结果返回所属能力与正式消费者。
4. 失败包装为携带 command 和原始 cause 的 `AppError`。

### 权限判定

1. 共享解析建立绑定、转导出、词法调用与位置。
2. command 检查沿实际符号来源解析传输调用。
3. 调用的 command 字面量与所属文件共同匹配正式 owner。
4. 能力检查独立约束公开操作的消费职责。

## 规范

- `AppError.command` 必须表达底层 command；`formatError` 必须透过该包装消费原始用户文案投影。
- command 声明与登记必须消费共同命令生成规则；业务函数参数与返回值必须保留所属能力契约。
- command 宏必须只处理命令声明、参数转交和执行计时；保存顺序与业务准备必须由所属服务维护。
- command 必须由可静态判定的字面量表达；别名、namespace、转导出和动态模块导入必须保留来源。
- commands 目录中的生产函数必须声明 `#[command_macros::command]`；业务处理和执行辅助函数必须归所属服务维护。
- `errorContextOf` 必须分别表达领域 action 和 command，日志必须按所属字段记录。
- `errorDiagnosticOf` 必须保留来源稳定码、原始消息和结构化位置；附加 payload 必须沿 cause 消费。
- `invokeCommand` 必须保留完整 args，nullable、无参数及顶层参数必须服从 Rust command 契约。
- 保存动作必须通过 `save_project` 交付捕获内容及修改，动作名称与所属业务服务必须匹配。
- 联合读取、准备及提交必须唯一归 joint-edit 能力；编辑目标登记、查询、预约与聚焦必须归窗口能力。
