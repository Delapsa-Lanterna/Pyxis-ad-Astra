# 文件历史与回放

## 定义

文件历史与回放模块提供已写盘文件变更的撤销与重做。

## 参考

### 拥有

- `src-tauri/src/commands/file_history.rs`：文件历史查询与清空 command。
- `src-tauri/src/services/file_history.rs`：历史查询与清空的正式范围授权、根租约及内部记录能力交付。
- `src-tauri/src/services/file_history/`：按实际 Mod 根持有 changeset、双栈、revision、容量及回放交接。
- `src/orchestrators/file-history-replay.orchestrator.ts`：明确目标的历史摘要刷新、回放计划、复核、执行及实际结果交付。
- `src/services/file-history.service.ts`：历史读取、清空与按条目回放能力包装。
- `src/stores/file-history.store.ts`：带版本的历史摘要投影。

### 消费

- `src-tauri/src/io/file_changes.rs`：历史清空消费的根写入租约。
- `src-tauri/src/models/file_history.rs`：历史查询、清空与回放请求、条目摘要及双栈快照。
- `src-tauri/src/services/project/mod.rs`：历史读取与清空消费的 session 及根归属核对。
- `src-tauri/src/services/project/session.rs`：会话打开、关闭、内容更新与内部登记及就绪访问能力交付。
- `src/shared/types/file-history.types.ts`：历史查询、清空与回放请求、条目摘要及双栈快照契约。
- `src/shared/types/write-commit.types.ts`：公共保存回执、提交同步、行键映射与正式内容交付。
- `src/stores/project.store.ts`：指定 Mod 的正式清单与 session 查询，异步动作消费捕获目标。

### 装配

- `src/orchestrators/project-sync.orchestrator.ts`：回放消费的提交同步入口，交付历史摘要与会话正式内容。

### 关联

- `src-tauri/src/services/write_transactions.rs`：根写入租约、版本复核、历史登记、回放及会话内容接纳。
- `src/test/fixtures/write-result.ts`：跨写入场景的正式提交结果夹具。

## 边界

- dirty 文本窗口消费外部暂存，回放结果由项目同步的有序保存通道交付。
- 主窗口历史命令按当前编辑面的草稿优先分派，settings 的 `fileHistoryLimit` 提供文件保存历史容量。
- 保存及回放共用实际 changeset 和提交同步，目录事件逐文件展开失效范围。
- 前端 store 持有带版本的摘要，回放编排拥有明确目标的计划、复核和执行，工作区拥有影响确认及展示交接。
- 后端文件历史按 canonical Mod 根持有已写盘 changeset、双栈和版本，登记、回放准备、回放接纳及清空统一归所属入口。
- 待同步记录归事务运行态，前端消费 receipt 和可重试进度。
- 根事务协调磁盘应用、失败恢复与历史推进，IO 核对当前路径及父链。

## 链路

### 登记

1. command 将保存请求交给根目录 FIFO 事务。
2. 事务校验会话和基线版本，调用所属写服务并登记实际 changeset。
3. 保存在历史与正式内容登记完成后返回结果并发布历史摘要。
4. 所属编辑会话沿内容接纳入口更新保存基线并保留后续草稿。

### 查询与清空

1. 历史 command 交付捕获的 session 与 Mod 根。
2. 历史服务核对范围并读取摘要；正式内容 pending 期间沿用所属 session 的历史。
3. 清空先取得根租约，再核对 session 与根，清除双栈并推进 revision。
4. 所属前端按读取寿命、项目身份及历史版本接纳结果。

### 回放计划

1. 工作区动作捕获 Mod 根与 session，读取后端最新历史摘要。
2. 文件历史按明确目标、栈顶条目 ID 与历史版本构造回放计划。
3. 工作区向用户呈现影响文件并等待确认。

### 回放执行

1. 用户确认后提交条目 ID、回放方向和预期历史版本。
2. 后端队列校验当前栈顶、文件现状和路径边界，应用快照并推进历史。
3. 回放结果以本次实际方向表达 before/after，前端接纳历史投影。
4. 同步编排接纳事务返回的会话正式内容，统一提交事件驱动文本与身份交接。
5. 回放工作在正式结果发布后释放，显示更新失败由消费者处理。

### 撤销与重做

1. undo 弹出撤销记录执行回放，成功后记录进入 redo。
2. redo 反向执行，成功后记录回到 undo。
3. Rust 历史状态依据应用设置裁剪 undo 栈。

## 规范

- commit 与 replay 共用正式结果登记；磁盘与历史已完成时，正式内容更新失败由当前项目保存任务继续处理。
- dirty 文本编辑器只允许暂存回放文本并提示，严禁覆盖当前输入。
- 历史列表消费 `FileHistoryEntrySummary`；摘要只包含条目 ID、标签、时间与路径，完整变更归后端历史记录。
- 历史双栈与 revision 必须只由记录状态修改；历史服务维护查询与清空授权，事务消费登记及回放交接接口。
- 历史只允许记录后端实际写盘 changeset，回放前必须重新核对全部路径与父链。
- 历史必须保存身份变化与双路径记录；回放按实际方向返回身份变化、目标版本及路径范围。
- 双栈 limit 由后端应用设置的 `fileHistoryLimit` 输入；设置加载和保存立即裁剪最早的 undo，redo 保留，历史清空在所属根租约内核对 session 后执行。
- 回放必须复用首次保存的 before/after 快照，严禁重新计算。
- 回放确认必须显式展示影响文件集合，严禁静默执行。
- 失效与文本同步必须共同覆盖源与目标；同一物理文件的大小写改名保留实际方向与文件名。
- 未完成登记必须归当前保存工作，历史裁剪保持所属恢复能力，完成或明确放弃后释放工作。
- 文件回放必须经所属项目队列，消费者接纳核对会话及当前路径，内容更新独立于回放完成。
- 新回放必须消费所属项目执行顺序；内容读取重试归消费者，严禁再次执行磁盘回放。
- 磁盘回放失败必须恢复本次文件修改并保持历史状态不变；磁盘成功后的登记失败保留当前工作。
