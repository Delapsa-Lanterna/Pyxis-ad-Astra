# 项目同步

## 定义

项目同步模块协调按根排队的来源变化与保存结果、窗口内容接纳和完成释放。

## 参考

### 拥有

- `src-tauri/src/commands/project_session.rs`：项目打开与来源监听装配的 command。
- `src-tauri/src/commands/project_sync.rs`：项目释放、结果订阅、来源确认、项目等待与恢复控制。
- `src-tauri/src/services/project_sync.rs`：项目保存队列、完整会话释放、结果发布和未完成工作寿命。
- `src-tauri/src/services/project_sync/source_changes.rs`：根订阅角色与寿命、来源状态、合并批次、后台排队及 Core 分发。
- `src/app/components/ProjectSyncNotice.vue`：所属未完成交接的显示。
- `src/app/composables/use-project-sync-view-model.ts`：失败交接重试与用户反馈。
- `src/domain/project-sync/`：正式保存回执和变更集的文件文本投影。
- `src/orchestrators/project-sync.orchestrator.ts`：窗口内保存消费过程和内容维护者交接。
- `src/services/project-sync.service.ts`：所属同步命令与有序通道交付。
- `src/stores/project-sync.store.ts`：当前待办、错误和项目等待状态。

### 消费

- `src-tauri/src/models/project_sync.rs`：项目同步通知、来源状态及前后端有序交付协议。
- `src-tauri/src/models/save_action.rs`：统一保存入口消费的请求与业务动作。
- `src-tauri/src/models/write_commit.rs`：实际保存结果、窗口交付及公共写入协议。
- `src-tauri/src/services/file_history.rs`：最后同根项目注销后的历史释放。
- `src-tauri/src/services/file_history/records.rs`：按实际 Mod 根持有 changeset、双栈、revision、容量及回放交接。
- `src-tauri/src/services/java_analysis.rs`：注销前释放所属 Java 项目，引用发布后刷新已启动分析项目。
- `src-tauri/src/services/java_analysis/sessions.rs`：按正式 Mod 身份释放分析项目与刷新引用输入。
- `src-tauri/src/services/project/mod.rs`：原子注销事实、会话内容清理及引用状态交接。
- `src-tauri/src/services/project/performance.rs`：ProjectSession 阶段计时。
- `src-tauri/src/services/project/query/entity_targets.rs`：可靠来源改名后的实际实体目标。
- `src-tauri/src/services/project/resources/media_cache.rs`：完整项目释放中的所属 session 媒体清理。
- `src-tauri/src/services/project/session.rs`：会话打开、关闭、内容更新与内部登记及就绪访问能力交付。
- `src-tauri/src/services/project/session/`：会话授权、就绪访问、CSV 正式内容、引用及来源版本管理。
- `src-tauri/src/services/project/sources/`：授权来源发现、带版本读取、Core 共享成果及规格文档装载。
- `src-tauri/src/services/project_session.rs`：游戏根与 Mod 根授权、来源输入准备及会话范围核对。
- `src-tauri/src/services/source_watch.rs`：共享根监听与变化批次。
- `src-tauri/src/services/windows.rs`：窗口范围、实际编辑来源、关闭及释放。
- `src/app/composables/use-app-feedback.ts`：窗口反馈的提供与消费入口。
- `src/orchestrators/window-event-errors.orchestrator.ts`：窗口事件失败的统一反馈交接。
- `src/services/project-readiness.service.ts`：正式读取门控。
- `src/services/query-cache.service.ts`：所属查询和在途读取失效。
- `src/services/resource-media.service.ts`：资源缓存与租约失效。
- `src/shared/types/project-sync.types.ts`：项目同步通知与来源状态协议。
- `src/shared/types/write-commit.types.ts`：所属保存结果及 SaveAcceptanceTask 接纳回调契约。
- `src/stores/file-history.store.ts`：文件历史摘要接纳。
- `src/stores/project.store.ts`：当前会话清单。
- `src/windows/window-context.window.ts`：只读上下文、请求监听接纳及上下文版本的前端运行态。

### 装配

- `src-tauri/src/services/project_save.rs`：完整保存请求捕获、业务准备与队列执行交付。
- `src/app/composables/use-app-lifecycle-assembly.ts`：窗口通道建立和释放。
- `src/orchestrators/workspace-lifecycle.orchestrator.ts`：项目关闭与运行态释放。

## 边界

- 保存提交交付实际写盘结果及完整受影响范围。
- 各内容维护者拥有所属内容接纳、读取与草稿交接。
- 同一请求的失败信息和窗口待办归同一登记维护。
- 同一项目的文件动作按队列顺序完成写入、恢复及正式结果登记。
- 窗口交付消费所属项目与原生窗口身份。
- 窗口内待办只持有尚未完成的处理步骤。
- 整批文本保存等待所属项目队列及当前窗口内容接纳结束后交付完成。
- 接纳步骤消费公共 SaveAcceptanceTask，执行顺序、失败位置和维护者释放归项目同步。
- 项目释放清理所属通道等待和业务运行态。
- 来源订阅登记实际根及 Mod/Core 角色，窗口根替换接纳所属状态快照。
- 来源批次的入队与执行分别推进，入队读取会话登记身份，每根持有当前工作及一个合并后续项；执行批次向 Core 与同根项目交付共享文件字节和目录枚举。
- 文件变化监听关闭后，项目同步等待已入队批次结束并释放来源提示；开启后的重扫沿相同根队列接纳。
- 自动来源刷新在后台执行，主动重试发布扫描状态；来源错误按根交付诊断，批次调试日志记录来源根、路径、改名、重扫标志、耗时与结果。
- Core 变化使用独立根通知，内容失败与保存结果共用有序任务和重试。
- Core 产品任务分别接纳完成结果，窗口通道分别接纳交付错误。
- 来源改名按原生顺序映射到最终位置，已登记编辑文件优先交付精确路径映射，目录及连续改名共同参与。

## 链路

### 保存交接

1. 保存请求进入所属项目队列并执行实际文件事务。
2. 完整结果经有序通道交给所属窗口。
3. 窗口接纳历史和清单，依次失效资源及查询缓存。
4. 窗口消费过程执行发起会话的保存接纳及相关会话的身份与内容交接。
5. 保存调用按项目执行结果返回，内容维护者独立完成必要读取。
6. 保存工作在结果发布后释放，内容更新失败归所属消费者处理。

### 失败与关闭

1. 项目恢复失败交付实际文件与处理步骤并保留所属工作。
2. 恢复重试继续未完成步骤，内容读取重试独立维护。
3. 关闭等待项目工作并明确处理放弃恢复，再检查未保存草稿。
4. 会话结束释放各内容维护者和当前项目运行态。

### 来源变化

1. 打开装配在读取基线前订阅实际根，登记消费方及 Mod/Core 角色后激活。
2. 合批交付在所属根队列登记当前工作和一个合并后续项，后台执行各自等待根队列。
3. 来源读取与正式内容完成全部受影响候选并接纳实际版本，项目同步交付身份及内容结果。
4. Core 根先完成共享缓存失效，再分别交付窗口与各 Mod 根队列。
5. 窗口内容步骤经同一有序消费过程接纳，失败保留尚未完成的所属任务并由实际 owner 重试。

### 完整项目释放

1. 应用生命周期或迟到打开清理交付实际 session，先释放所属 Java 分析项目，再捕获引用代次。
2. 注销前捕获当前来源快照，注册表原子注销并返回最后同根事实，登记锁外完成最后同根缓存交付；项目同步释放所属历史，再依次清理所属媒体和会话引用。
3. 引用变化经所属快照交付存活订阅，交付错误进入诊断，随后释放窗口目标登记。
4. 调用方接纳实际释放结果，前端内容消费者与工作区释放各自运行态。

## 规范

- 保存重建确认必须逐项列出实际缺失路径并说明使用已读取内容加本次修改；结束恢复确认逐任务交付项目、请求、路径和完整诊断。
- 引用来源由主窗口按标签顺序发布，来源修改、关闭及保存通过现有通道交付递增版本并重接相关内容。
- 新窗口必须先接收引用来源快照再使用引用缓存，范围版本变化撤销旧读取的接纳权并保留接收方草稿与输入。
- 保存事件必须共同携带实际内容、身份、行键、历史及受影响会话范围。
- 原生窗口必须使用有序通道接收保存交付，异步处理按所属消费顺序等待。
- 同一内容职责具有一个接纳入口，完整内容直接接纳，必要补充读取等待成功。
- 同一项目的后续文件动作必须等待当前项目工作完成，其他项目独立推进。
- 已完成步骤必须立即释放，重试继续所属未完成步骤。
- 正式历史和清单接纳及缓存失效必须先于内容维护者读取。
- 文件写入失败必须恢复本次修改，恢复失败保留所属请求与后续队列，校验拒绝与来源确认归所属动作处理。
- 保存成功必须以全部文件、历史和正式项目内容登记完成为准，显示读取失败独立报告。
- 后端结果订阅必须独立于保存寿命，订阅释放只释放所属接收。
- 内容读取失败后的新保存交付必须更新当前内容，严禁迟到重试接纳较早内容。
- 项目及工具关闭的恢复放弃确认归主窗口统一处理，单窗关闭归所属窗口处理。
- 完整释放必须先结束所属 Java 分析项目，再依次原子注销会话、释放最后同根历史、清理所属媒体、更新引用、交付引用变化并清理窗口目标登记；前端本窗口内容释放通过 releaseProjectContentConsumers 交付。
- 外部磁盘批次必须进入所属根队列，同一物理文件的本批内容读取必须复用一次成果；实际变化必须交付全部存活同根会话，条目通知必须沿现有文件树更新入口交付，来源错误必须经有序通道交给所属窗口。
- 来源失败与恢复状态按根保留并向后续窗口交付，正常监听状态仅在变化时发布；保存等待保留独立来源诊断，重试消费原根及实际读取结果。
- Core 批次必须先完成共享来源缓存失效，同根项目必须复用所属来源批次接纳内容，其它项目必须分别进入所属 Mod 队列并交付所属窗口；来源刷新失败后必须结束已登记的所属队列任务，窗口和会话订阅必须分别释放。
