# 文件历史与回放

## 定义

文件历史与回放模块提供已写盘文件变更的撤销与重做。

## 参考

### 拥有

- `src-tauri/src/commands/file_history.rs`：文件历史查询、清空与按条目回放 command。
- `src-tauri/src/services/file_history.rs`：文件历史内存状态，按 canonical Mod 根持有快照、双栈与版本。
- `src/app/components/file-history/WorkspaceFileHistory.vue`：历史摘要、确认与回放动作的展示入口。
- `src/app/composables/editors/use-file-history-view-model.ts`：文件历史视图 ViewModel。
- `src/orchestrators/file-history-replay.orchestrator.ts`：历史编排，拥有已加载会话摘要刷新、回放计划、确认交互、执行与确认 UI。
- `src/services/file-history.service.ts`：历史读取、清空与按条目回放能力包装。
- `src/stores/file-history.store.ts`：带版本的历史摘要投影。

### 消费

- `src-tauri/src/models/file_history.rs`：历史查询、清空与回放请求、条目摘要及双栈快照。
- `src/orchestrators/main-history-command.orchestrator.ts`：主窗口历史分派。
- `src/orchestrators/project-sync.orchestrator.ts`：回放消费的提交同步入口，交付历史摘要与会话投影。
- `src/shared/types/file-history.types.ts`：历史查询、清空与回放请求、条目摘要及双栈快照契约。
- `src/shared/types/write-commit.types.ts`：公共保存回执、提交同步、行键映射与正式内容交付。
- `src/stores/project.store.ts`：指定 Mod 的正式清单与 session 查询，异步动作消费捕获目标。
- `src/stores/workspace.store.ts`：当前 Mod 选择、清单与 session 的派生投影。

### 关联

- `src-tauri/src/services/write_transactions.rs`：根写入租约、版本复核、历史登记、回放及投影提交。
- `src/test/fixtures/write-result.ts`：跨写入场景的正式提交结果夹具。

## 边界

- dirty 文本窗口消费外部暂存，回放结果由项目同步的有序保存通道交付。
- 主窗口历史命令按当前编辑面的草稿优先分派，settings 的 `fileHistoryLimit` 提供文件保存历史容量。
- 保存及回放共用实际 changeset 和提交同步，目录事件逐文件展开失效范围。
- 前端 store 持有带版本的摘要，回放编排拥有计划、影响确认和执行。
- 后端文件历史按 canonical Mod 根持有已写盘 changeset、双栈和版本，登记、回放准备、回放接纳及清空统一归所属入口。
- 待同步记录归事务运行态，前端消费 receipt 和可重试进度。
- 根事务协调磁盘应用、失败恢复与历史推进，IO 核对当前路径及父链。

## 链路

### 登记

1. command 将保存请求交给根目录 FIFO 事务。
2. 事务校验会话和基线版本，调用所属写服务并登记实际 changeset。
3. 保存必须在历史与正式内容登记完成后返回结果并发布历史摘要。
4. 所属编辑会话必须沿内容接纳入口更新保存基线并保留后续草稿。

### 回放计划

1. 主窗口命令分派捕获 Mod 根与 session，进入所属文件历史回放。
2. 编排读取后端最新历史摘要，以栈顶条目 ID 与历史版本构造回放计划。
3. 以确认交互向用户呈现影响文件并等待确认。

### 回放执行

1. 用户确认后提交条目 ID、回放方向和预期历史版本。
2. 后端队列校验当前栈顶、文件现状和路径边界，应用快照并推进历史。
3. 回放结果以本次实际方向表达 before/after，前端接纳历史投影。
4. 同步编排接纳事务返回的会话投影，统一提交事件驱动文本与身份交接。
5. 回放工作必须在正式结果发布后释放，显示更新失败必须由消费者处理。

### 撤销与重做

1. undo 弹出撤销记录执行回放，成功后记录进入 redo。
2. redo 反向执行，成功后记录回到 undo。
3. Rust 历史状态依据应用设置裁剪 undo 栈。

## 规范

- applySnapshot 必须由项目同步、历史回放或文件历史 ViewModel 接纳正式后端快照，并核对所属读取寿命、项目身份及版本。
- 文件历史撤销与重做的展示动作必须返回所属回放任务，调用者必须按实际用途等待或交接完成状态。
- commit 与 replay 必须共用正式结果登记；磁盘与历史已完成时，投影失败必须由当前项目工作继续处理。
- dirty 文件编辑器只允许暂存回放文本并提示，严禁覆盖当前输入。
- 历史列表必须消费 `FileHistoryEntrySummary`；摘要必须只包含条目 ID、标签、时间与路径，完整变更必须归后端历史记录。
- 历史双栈与 revision 必须只由文件历史模块修改，事务必须消费登记、查询、清空及回放交接接口。
- 历史只允许记录后端实际写盘 changeset，回放前必须重新核对全部路径与父链。
- 历史必须保存身份变化与双路径记录；回放必须按实际方向返回身份变化、目标版本及路径范围。
- 历史读取与通知必须按 session 和历史版本接纳；迟到通知严禁改变较新的历史投影，最后一个同根 session 关闭后必须释放历史。
- 历史页面初载与右键刷新必须共用所属读取票据，目标交接与释放必须撤销接纳，成功必须按 Mod 根、session 和历史 revision 更新摘要。
- 双栈 limit 必须由后端应用设置的 `fileHistoryLimit` 输入；设置加载和保存必须立即裁剪最早的 undo，redo 必须保留，历史清空必须经后端队列执行。
- 回放必须复用首次保存的 before/after 快照，严禁重新计算。
- 回放摘要读取、计划、确认及执行必须消费发起时捕获的 Mod 根与 session。
- 回放确认必须显式展示影响文件集合，严禁静默执行。
- 失效与文本同步必须共同覆盖源与目标；同一物理文件的大小写改名必须保留实际方向与文件名。
- 当前展示目标必须消费工作区的当前项目投影，异步动作必须捕获并持续消费所属 Mod 根与 session。
- 未完成登记必须归当前保存工作，历史裁剪必须保持所属恢复能力，完成或明确放弃后必须释放工作。
- 撤销与重做面板必须由同一展示结构消费各自记录、可用状态与正式动作，记录身份必须保持稳定。
- 文件回放必须经所属项目队列，消费者接纳必须核对会话及当前路径，内容更新必须独立于回放完成。
- 新回放必须消费所属项目执行顺序；内容读取重试必须归消费者，严禁再次执行磁盘回放。
- 登记的变更必须来自后端实际写盘结果，严禁前端拼装。
- 磁盘回放失败必须恢复本次文件修改并保持历史状态不变；磁盘成功后的登记失败必须保留当前工作。
- 设置保存后的摘要刷新必须查询所有已加载 Mod；接纳必须共同核对捕获 session、Mod 根、所属设置生命周期及历史 revision。
