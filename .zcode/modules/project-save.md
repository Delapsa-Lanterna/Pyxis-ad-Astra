# 项目保存调度

## 定义

项目保存调度模块协调 Mod 保存批次及完整保存请求的业务准备、排队执行与实际结果返回。

## 参考

### 拥有

- `src-tauri/src/commands/project_save.rs`：发起窗口与完整保存请求的 command 入口。
- `src-tauri/src/services/project_save.rs`：完整请求捕获、业务动作准备、执行与结果交接。
- `src/orchestrators/mod-save.orchestrator.ts`：当前 Mod 的跨窗口参与者捕获、保存批次、请求合并与结果汇总。

### 消费

- `src-tauri/src/models/save_action.rs`：保存请求及封闭业务动作。
- `src-tauri/src/services/config_entity.rs`：JSON 实体正式内容准备与实际写入。
- `src-tauri/src/services/json_file.rs`：Variant 与 Skin 文件保存及身份操作。
- `src-tauri/src/services/misc_config.rs`：已登记配置文件的实际保存与删除。
- `src-tauri/src/services/project/session.rs`：会话打开、关闭、内容更新与内部登记及就绪访问能力交付。
- `src-tauri/src/services/project/session/references.rs`：有序引用来源、代次、共享快照与按需表格视图。
- `src-tauri/src/services/project/session/source_refresh.rs`：同根正式候选构造、手动及自动来源接纳、缺失路径与 Core 会话更新。
- `src-tauri/src/services/project/write/csv_patch.rs`：CSV patch、关联规格、行键及同根 changeset 装配。
- `src-tauri/src/services/project/write/entity_write/content.rs`：实体内容、关联规格准备与复核、描述、父引用、单文件和势力索引写入。
- `src-tauri/src/services/project/write/joint_edit.rs`：联合当前来源图准备、身份与修改接纳及实际保存。
- `src-tauri/src/services/project/write/json_recovery.rs`：缺失基线渲染、必要索引修复和实际 changeset。
- `src-tauri/src/services/project_sync.rs`：项目队列、来源确认、恢复等待和结果发布。
- `src-tauri/src/services/text_editor.rs`：文本内容准备与实际写入。
- `src-tauri/src/services/write_transactions.rs`：根租约、版本核对、实际提交及文件回放。
- `src/services/window.service.ts`：保存接收登记、目标拥有窗口查询、请求与代次绑定回执。
- `src/stores/project.store.ts`：捕获 Mod 的正式 session 与清单复核。
- `src/stores/save-command.store.ts`：文档保存参与者、输入、所属请求与等待。
- `src/stores/workspace.store.ts`：主窗口当前 Mod 选择。
- `src/windows/current.window.ts`：当前原生窗口 label。
- `src/windows/window-context.window.ts`：子窗口实际所属项目身份。

### 装配

- `src-tauri/src/commands/mod.rs`：正式保存 command 登记。
- `src-tauri/src/services/mod.rs`：业务准备与写入能力导出。
- `src/app/composables/use-app-lifecycle-assembly.ts`：保存协调实例、窗口快捷键与作用域释放装配。

## 边界

- Mod 保存协调持有批次队列、参与者快照与在途请求，具体文档由所属编辑会话保存。
- 完整保存请求归发起编辑会话，项目保存调度持有捕获请求至实际执行结果返回。
- 业务内容准备归所属编辑模块，调度消费明确业务入口。
- 项目同步持有 FIFO、来源确认、失败等待与结果发布状态。
- 文件事务持有根租约、版本核对、历史及已写盘正式内容恢复。
- 引用来源通知消费已完成提交结果，通知诊断归正式诊断入口。

## 链路

### Mod 保存批次

1. 主窗口捕获当前 Mod 清单，子窗口捕获所属项目身份，并向主窗口交付批次请求。
2. 主窗口合并同目标批次，按窗口和文档目标捕获实际保存参与者。
3. 所属窗口复核捕获身份、等待已有保存、提交输入并执行文档保存。
4. 批次汇总实际保存、取消及失败结果，返回发起窗口反馈。
5. 批次结束移除在途记录，窗口作用域释放所属代次的保存接收登记。

### 保存请求

1. command 交付发起窗口及完整保存请求。
2. 调度捕获实际项目根、session 和动作原因并登记项目队列。
3. 队首工作取得执行位置并交接前序身份与版本。
4. 所属业务准备当前正式内容，事务取得根租约并核对凭据。
5. 所属业务交付实际写入结果，事务完成历史及正式内容登记。
6. 同步发布实际结果并释放队首，调度返回结果及交付引用来源更新。

## 规范

- Mod 批次必须捕获 session 与根；同目标重复请求复用在途任务，不同目标按捕获顺序执行。
- 跨窗口参与者必须绑定句柄编号与目标键；执行前复核登记、目标与关闭状态，接收释放按原代次交还。
- 保存动作必须由封闭请求类型穷尽分派，具体编辑规则归所属业务入口。
- 保存请求必须消费捕获的根、session、修改与发起窗口，等待覆盖所属项目执行。
- 实际文件修改必须经正式事务入口，文件回放与来源刷新消费各自正式流程。
- 结果必须由实际提交决定，引用通知失败保留提交结果并交付诊断。
- 项目队列必须覆盖来源确认、业务准备、文件执行、失败恢复、历史及正式内容登记。
