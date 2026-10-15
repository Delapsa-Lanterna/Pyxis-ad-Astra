# 应用反馈与错误恢复

## 定义

应用反馈与错误恢复模块统一通知、确认、诊断呈现和授权文件恢复入口。

## 参考

`src-tauri/src/errors.rs`：后端稳定码、原始错误链、位置与附加 payload。
`src/app/app-feedback.ts`：反馈工厂及恢复动作 owner。
`src/app/composables/use-app-feedback.ts`：唯一工厂消费 hook。
`src/domain/app-feedback.ts`：错误路径所属会话解析。
`src/shared/lib/errors.ts`：`AppError`、诊断与文案投影主归属。
`src/shared/types/error.types.ts`：诊断与通知对象。
`src/shared/types/feedback.types.ts`：反馈公开交接类型。

## 边界

- message、dialog 与 `AppFeedback` 由统一 hook 装配，编排消费注入的反馈。
- 原始错误与通知对象由动作提供，反馈工厂分别投影用户文案与原始诊断。
- 文件恢复消费所属 session 或后端 recovery 目标，后端拥有路径授权。
- 日志能力接纳结构化诊断，反馈层拥有提示、确认与恢复动作的呈现。
- 转码写入归 files 能力，反馈层消费其 receipt 和保存同步结果。

## 链路

### 错误呈现与恢复

1. 用户动作提交原始错误或通知对象。
2. 工厂映射用户文案并取得结构化位置。
3. 路径与已加载 manifest 或当前子窗口身份匹配所属会话。
4. 提示展示位置与已授权文件动作。
5. 文件打开经窗口能力，转码经 files 能力及保存同步。
6. 原始诊断、action、command 和位置进入日志能力。

### 确认

1. 所属动作提供确认内容和回调。
2. 工厂装配 dialog，确认调用 onConfirm。
3. 取消、关闭或遮罩调用 onCancel。

## 规范

- ID 校验拒绝必须为 warning，稳定码必须为 config.id_invalid。
- error/warning 必须记录原始诊断，success/info 严禁隐式写日志。
- spec.target_exists 的身份意图错误必须携带实际已加载 target；聚焦必须消费该 payload，文案和日志必须继续消费来源诊断。
- 反馈工厂必须由 hook 注入 message 与 dialog，文件会话解析必须优先消费已加载 manifest，再消费当前子窗口自身身份。
- 提示基线必须由唯一 WindowShell provider 承载，可手动关闭且悬浮暂停；普通提示 10 秒，error duration 必须为 0。
- 提示必须由工厂统一渲染文件位置和授权恢复按钮，调用方严禁自建时长、关闭与渲染选项。
- 文件位置必须从 location 消费，行列必须从 1 开始，列必须按 UTF-16 单元表达。
- 文案映射必须按稳定码和领域上下文产生；command 包装必须保持呈现透明，父子文案必须去重。
- 转码只允许 text.invalid_utf8 且目标授权时提供，源编码必须由用户显式选择。
- 转码必须接入文件保存及历史链路，打开或转码失败必须记录原始诊断并呈现一次错误。
- 错误链必须保留来源 code、位置与 payload；action 和 command 必须独立表达。

## 陷阱

- 从文案推导错误位置和根目录会使恢复动作使用未授权目标。
- 在业务组件复制反馈工厂会让提示和恢复动作出现不同接纳边界。
- 将用户文案作为原始诊断会丢失后端错误链及稳定码。
