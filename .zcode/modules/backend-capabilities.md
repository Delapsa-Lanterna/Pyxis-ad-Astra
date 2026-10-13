# 后端能力与 IPC 传输

## 定义

后端能力与 IPC 传输模块提供类型化跨进程调用及能力归属契约。

## 参考

`scripts/architecture/rules/command-boundary.mjs`：command 来源与唯一 owner 检查。
`scripts/shared/command-policy.mjs`：正式 command 实现归属表。
`scripts/shared/frontend-source.mjs`：词法调用、绑定与源码位置事实。
`src-tauri/src/commands/mod.rs`：command 模块注册及共享所属会话校验入口主归属。
`src/shared/runtime/command-runtime.spec.ts`：传输与来源诊断验收。
`src/shared/runtime/command.runtime.ts`：唯一原始 invoke owner。

## 边界

- `AppError` 保留 command 和原始 cause，领域 action 由用户动作提供。
- `command.runtime` 拥有唯一原始 invoke 调用与透明错误包装。
- 所属 service 或 wire 实现拥有 command 参数装配，共享传输消费完整参数。
- 能力矩阵维护公开操作权限，command-policy 维护实际 command 实现归属。
- 静态检查消费共享符号来源、调用和位置事实，分别验证 command owner 与能力消费者。

## 链路

### 跨进程调用

1. 所属能力装配 command 与 payload 或顶层参数。
2. `invokeCommand` 调用 Tauri invoke。
3. 成功结果返回所属能力与正式消费者。
4. 失败包装为携带 command 和原始 cause 的 `AppError`。

### 权限判定

1. 共享解析建立绑定、转导出、词法调用与位置。
2. command 检查沿实际符号来源解析传输调用。
3. 调用的 command 字面量与所属文件共同匹配正式 owner。
4. 能力检查独立约束公开操作的消费职责。

## 规范

- `AppError.command` 必须表达底层 command；`formatError` 必须透过该包装消费原始用户文案投影。
- command 必须由可静态判定的字面量表达；别名、namespace、转导出和动态模块导入必须保留来源。
- `errorContextOf` 必须分别表达领域 action 和 command，日志必须按所属字段记录。
- `errorDiagnosticOf` 必须保留来源稳定码、原始消息和结构化位置；附加 payload 必须沿 cause 消费。
- `invokeCommand` 必须保留完整 args，nullable、无参数及顶层参数必须服从 Rust command 契约。
- 联合读取、准备及提交必须唯一归 joint-edit 能力；编辑目标登记、查询、预约与聚焦必须归窗口能力。

## 陷阱

- 在传输层组装业务字段会让 wire 参数脱离所属能力定义。
- 用 command 名替代用户动作会混淆底层诊断与操作文案。
- 错误包装丢弃 payload 会使冲突聚焦与恢复动作失去正式目标。
