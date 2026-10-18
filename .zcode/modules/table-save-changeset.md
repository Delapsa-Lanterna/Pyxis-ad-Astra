# 表格保存与变更集

## 定义

表格保存与变更集模块将 CSV 草稿和关联规格动作交付原子保存。

## 参考

### 拥有

- `src-tauri/src/domain/csv_column_order.rs`：CSV 标准列资产与补列排序，供联合 write 消费。
- `src-tauri/src/domain/spec_construction.rs`：关联规格创建构造与武器类型约束。
- `src-tauri/src/services/project/write/csv_patch.rs`：CSV patch、关联规格、行键及同根 changeset 装配。
- `src-tauri/src/services/project/write/csv_staging.rs`：CSV 表草稿、最终文本暂存及成功写盘后的会话接纳。
- `src/app/components/AssociatedSpecSaveDialog.vue`：关联规格选择与武器创建类型的异步确认内容。
- `src/domain/tables/associated-spec-candidates.ts`：关联 spec 候选与动作快照。
- `src/domain/tables/associated-spec-creation.ts`：CSV 到创建参数与武器评分。
- `src/domain/tables/csv-dirty.ts`：dirty 行形状。
- `src/orchestrators/table-save.orchestrator.ts`：保存编排，以 `saveTableChanges` 拥有明确 Mod／表的输入提交、快照捕获、关联选择、写入与 receipt 接纳。

### 消费

- `src-tauri/src/models/table_save.rs`：CSV 保存请求、行修改、关联规格动作与写入目标。
- `src-tauri/src/services/project/cache/csv.rs`：按会话读取表快照并保留所属行身份与分配序列。
- `src/orchestrators/edit-target-handoff.orchestrator.ts`：消费所属 CSV 保存参与者、短暂表锁与写结果。
- `src/orchestrators/project-sync.orchestrator.ts`：表格保存消费的 receipt 同步与反馈入口。
- `src/services/csv-table.service.ts`：CSV 查询与保存能力包装，提交 patches、版本凭据与关联动作。
- `src/shared/types/table-save.types.ts`：CSV 保存请求、行修改、关联规格动作及正式写入目标契约。
- `src/shared/types/write-commit.types.ts`：公共保存回执、提交同步、行键映射与 JSON 写入契约。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。

### 关联

- `src-tauri/src/services/project/write/entity_description.rs`：舰船与武器描述行的身份改名和同根暂存。
- `src-tauri/src/services/project/write/ship_description_tests.rs`：舰船身份与描述行联合更新的集成验证。
- `src-tauri/src/services/project/write/weapon_description_tests.rs`：武器身份与描述行联合更新的集成验证。
- `src-tauri/src/services/write_transactions.rs`：根写入租约、版本复核、历史登记、回放及投影提交。
- `src/orchestrators/table-save.orchestrator.spec.ts`：保存编排行为测试。

## 边界

- FIFO 事务拥有版本复核、实际应用和文件历史，write 返回 `rowKey` map 与 invalidation。
- 保存期间的新草稿和历史归 tables 运行态，已写盘同步失败保留 receipt。
- 前端先接纳实际行基线、版本和历史映射，再由提交同步更新项目与窗口。
- 后端写服务在同根事务中构造 CSV 与关联规格、描述的原子 changeset。
- 正式 parser 拥有 CSV 与规格格式，标准列构造归列资产和所属来源。
- 编排按显式 manifest 和 table 捕获输入、patches、版本、关联选择与历史身份。
- 领域提供正式关联目标和创建参数，app 回调呈现用户选择。

## 链路

### 捕获保存目标

1. 用户触发保存或 Ctrl+S 进入保存编排。
2. 编排捕获完整目标并持有准备与保存状态。
3. 所属输入集合逐项提交原始输入，编排复核目标、session 与 tables 状态。
4. 编排捕获独立 patches、版本凭据、关联候选与历史身份集合。

### 提交保存

1. 目标为空或当前表无 dirty 时返回 noop；进行中的保存由同一 Promise 表达。
2. app 层选择回调按需加载确认内容，经所属反馈入口展示快照中的关联候选与创建类型，返回选定动作或取消。
3. 编排复核目标并消费同一快照中的 patches、关联动作与版本。
4. 调用排他写提交 patches 与关联动作。
5. 后端校验 session/root 与关联种类，按创建参数构造规格或解析已有来源更新 ID，构建并应用原子 changeset。
6. 返回写结果、`rowKey` map 与结构化失效。

### 保存后提交

1. session 已变化时保留 dirty 并返回 saved，不做本地提交。
2. 将提交 patches 和返回版本共同接纳到 original 基线。
3. 将当前行、编辑目标与草稿历史映射到保存后的 `rowKey`，按该基线重算 dirty。
4. 完整 receipt 进入统一接纳入口，投影历史、会话更新及缓存并发送提交通知。
5. 后续历史按保存捕获保留，保存状态统一结束。

## 规范

- CSV patch 保存必须原样保留文件自身表头与列集；联合字段补列必须消费明确提交意图及标准列顺序，全部 CSV 保存必须保留行序、注释身份、未知列与业务内容，并以真实格式测试验收。
- CSV patch 必须携带读取基线与 `isComment`，恢复行必须携带 `insertAt`；正式 `rowKey` 删除必须命中实际行，未知键必须返回冲突。
- CSV 保存必须消费正式 parser 的列数容忍、注释和空行模型，渲染必须使用最小引号规则及 LF 行。
- CSV 新增行的 `insertAt` 必须将省略与 `null` 共同解释为末尾插入；显式位置必须沿现有插入规则处理。
- CSV 暂存必须共同交付表身份、表头、行、分配序列及最终文本；正式表状态只允许在同根 changeset 应用成功后消费该暂存结果。
- CSV 最终行序必须在同一保存快照中捕获，源位置与新增行键必须在版本校验后解析；顺序必须完整、唯一且覆盖保存后的全部记录，内容与行序必须进入同一次文件历史。
- upsert patch 必须构造提交时的独立行快照，业务内容只允许从行记录 data 独立克隆，恢复位置必须从 `insertAt` 装配。
- upsert 的注释标记必须与业务快照共同固定并更新实际基线；关联规格候选必须消费原始行及当前行的正式注释身份。
- 保存入口必须显式接收 manifest 与 table，结果必须共同表达 status 与已写盘 receipt；关联表准备必须复用该动作。
- 保存快照必须在活动输入提交后、关联选择前固定；patches、关联行内容、版本与历史捕获必须属于同一次提交。
- 保存期间的查询与自身失效必须保留前端草稿；写后 refresh 必须保留与已写盘 after 快照相符的后端行身份。
- 保存状态必须覆盖整个提交窗口，同一编辑器重复触发必须保持当前请求；跨窗口请求必须进入后端队列。
- 保存行序接纳必须以提交顺序重建源位置，并共同映射当前草稿、输入身份与保留历史；保存期间的新内容、增删及历史回放结果必须保留。
- 保存请求期间的新编辑必须保留，original 必须以实际提交 patches 更新，dirty 必须按该基线重算。
- 关联 spec 动作必须与 CSV 变更构成同一次原子 changeset，严禁分次写入。
- 关联 spec 改名必须按本次 `preserveOriginalJson` 设置更新旧文件文本；需要整体重排时必须在 CSV 与 spec changeset 应用前确认。
- 关联候选列表必须在当前窗口内独立滚动，确认与取消必须保持可操作。
- 关联创建必须携带所属格式的创建参数；删除必须携带 ID，重命名必须携带原 ID 与目标创建参数。
- 关联目标与版本必须在确认前捕获；正式提交必须携带 `AssociatedSpecWrite` 的动作与实际 `EntityEditTarget`。
- 关联确认必须提供 projectile 与 beam 调整入口，并显示“pulse 在原版中无法正常处理，武器类型只允许 projectile 和 beam。”。
- 关联选择必须由 app 层提供可等待回调，取消必须结束准备状态；同一保存面重复触发必须复用进行中的请求。
- 再次保存必须先重试所属待同步 receipt；恢复成功后必须提交当前输入并捕获新快照，空闲保存必须保持即时捕获顺序。
- 删除 patch 必须携带删除动作标记，严禁以空 upsert 表达删除。
- 后台 CSV 交接必须消费捕获 manifest 与 table 的正式保存动作；联合规格装配必须复用身份规则并在实际 changeset 完成后发布行状态。
- 已有来源的保存、删除与改名必须消费实际已加载路径；改名必须保留原目录，来源缺失必须消费所属默认创建构造。
- 已有来源重命名必须保留全部业务内容并更新 ID；来源缺失的创建必须消费共享模板与目标创建参数。
- 武器 CSV 关联改名必须共同提交实际规格与所属 `WEAPON` 描述 ID；描述目标占用必须拒绝全部关联 changeset。
- 武器初始分支必须按 10 项 projectile 字段与 3 项 beam 字段的非空原文计分；零值必须计分，平分必须选择 projectile。
- 结构化失效必须由后端从同一 changeset 推导，严禁前端拼装失效路径。
- 联合字段补列必须消费 Core 权威表头或正式列资产；全部标准列必须按来源排序，自定义列必须保留内容与相对顺序。
- 舰船关联改名必须依据原规格的 `descriptionId` 声明决定默认描述行交接；默认描述 ID 更新必须共同进入 CSV 与规格事务、历史及结构化失效。
- 表格身份释放事件必须按原请求的 session 和 Mod 核对当前会话；回执只允许更新所属行与基线，会话重开后必须仅释放原锁。
- 表运行态只允许接纳所属 CSV 的基线版本；规格版本必须归关联保存快照与实体记录。
- 表锁必须覆盖提交与本地 receipt 接纳；锁定期间必须保持读取接纳与编辑动作归属，失败、窗口销毁和会话结束必须释放锁。
- 规格保存前必须提交并保存所属 CSV 草稿；取消或失败必须保留规格编辑面，完成准备后必须锁定所属表。
- 首列变化必须按正式注释身份装配标记；文字值以 # 开头的业务行必须保留字面内容和必要引号。

## 陷阱

- 保存失败后清除 dirty 会让用户误以为已保存。
- 只提交当前编辑单元格会丢失同批其它 dirty 变更。
- 将规范化后的本地 `rowKey` 映射写回后端 receipt 会污染提交结果的归属。
- 捕获后不校验 session 与状态变化会把保存写到旧目标。
- 绕过排他写会让同表并发保存产生交错 changeset。
