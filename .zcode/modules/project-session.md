# 项目会话与投影

## 定义

项目会话与投影模块管理已打开 Mod 的生命周期、清单与原子投影接纳。

## 参考

### 拥有

- `src-tauri/src/commands/project_session.rs`：session 生命周期 command。
- `src-tauri/src/domain/entity_definitions.rs`：八种实体的目录、后缀、ID 字段及规格、表格关联登记。
- `src-tauri/src/domain/entity_identity.rs`：跨编辑器实体 ID、路径与来源范围纯规则。
- `src-tauri/src/services/project/cache/mod.rs`：session 注册表、句柄与锁入口，以及缓存模块登记和能力导出。
- `src-tauri/src/services/project/definitions/config_sources.rs`：配置引用目录的来源名称、固定路径与对象分组登记。
- `src-tauri/src/services/project/definitions/entity_definitions.rs`：实体来源、读取准备、刷新与摘要的登记规则。
- `src-tauri/src/services/project/definitions/factions.rs`：势力来源装载、诊断与蓝图标签。
- `src-tauri/src/services/project/definitions/mod.rs`：会话实体与表格定义的模块登记。
- `src-tauri/src/services/project/definitions/projectiles.rs`：Mod 弹体及 Core 回退的正式读取。
- `src-tauri/src/services/project/invalidation.rs`：提交路径到会话投影、实体与资源失效的更新。
- `src-tauri/src/services/project/mod.rs`：会话生命周期、授权、投影、缓存配置与性能入口。
- `src-tauri/src/services/project/model.rs`：会话、已加载来源记录、CSV 行及 Core 缓存内部运行模型。
- `src-tauri/src/services/project/query/mod.rs`：只读业务实现的服务层可见模块登记。
- `src-tauri/src/services/project/root.rs`：任务索引统计行为验证。
- `src-tauri/src/services/project/session.rs`：会话打开、关闭与投影生命周期，注册表句柄经缓存运行时交接。
- `src-tauri/src/services/project/versions.rs`：会话已接纳来源的路径凭据投影。
- `src-tauri/src/services/project/write/mod.rs`：写入业务实现登记及内部暂存入口。
- `src-tauri/src/services/project_session.rs`：游戏根与 Mod 根授权、会话建立、提交与窗口登记释放及性能记录。
- `src/domain/project/entity-versions.ts`：保存目标版本捕获与关联表凭据交接。
- `src/domain/project/query-scopes.ts`：标准实体失效 scope 的种类、ID 与通配匹配。
- `src/services/project-projection.service.ts`：窗口内按 session 与提交序号维护读取门控的运行态。
- `src/services/project-session.service.ts`：session 打开、关闭与来源刷新协议。
- `src/stores/project.store.ts`：按 Mod 根管理全部 manifest、session 查询、表格写入目标与已接纳投影版本。

### 消费

- `src-tauri/src/models/mod.rs`：正式模型聚合、serde 输入原语及去重追加函数。
- `src-tauri/src/models/project_identity.rs`：会话、实体、表、资源、目标及版本身份与 session 范围实现宏。
- `src-tauri/src/models/project_session.rs`：会话请求、清单、摘要与正式失效结果。
- `src-tauri/src/services/project/cache/csv.rs`：表格 owner 的快照、稳定行身份与加载交接。
- `src-tauri/src/services/project/query/entities.rs`：实际实体详情与列表查询。
- `src-tauri/src/services/project/query/entity_targets.rs`：实体查询交付实际编辑目标、身份意图与版本范围。
- `src-tauri/src/services/project/resources/refs.rs`：资源身份、来源根和船体引用解析。
- `src-tauri/src/services/project/sources/`：成套来源内容、版本与解析成果读取。
- `src/domain/project/entity-definitions.ts`：共享实体内容 ID 字段、可用 ID 规则与目标身份投影。
- `src/services/entity-query.service.ts`：实体查询能力交接。
- `src/shared/types/project-identity.types.ts`：会话、实体、表、资源与文件版本身份的基础协议。
- `src/shared/types/project-session.types.ts`：会话请求、清单、摘要与正式失效结果。
- `src/shared/types/write-commit.types.ts`：公共保存回执、提交同步、行键映射与 JSON 写入契约。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。
- `src/orchestrators/project-sync.orchestrator.ts`：窗口内投影接纳、缓存失效、提交恢复及通知装配。

### 关联

- `src-tauri/src/services/project/write/entity_identity.rs`：规格、装配与文本身份写入及关联 CSV、父引用暂存。
- `src/shared/lib/paths.ts`：文件系统、资源及游戏目录的路径纯规则。

## 边界

- session 注册表持有授权根与会话 handle，各会话状态分别加锁。
- 关闭移除登记，已取得 handle 的在途操作自然完成，后续操作以未知 session 拒绝。
- 前端 project store 持有全部 manifest 和正式投影版本，工作区消费按根查询，项目同步交付完整投影。
- 势力及蓝图包提供 tags 元数据，来源变化参与全部相关表的失效。
- 后端 query 消费会话索引并返回只读结果，write 发布 changeset 和结构化投影。
- 媒体和查询等待按 session 释放，投影恢复归事务与提交同步入口。
- 持久化来源成果由来源读取交付，query 消费所属会话投影。
- 来源目录、实体记录和草稿资源由后端定义装配，前端能力交付所属消费者。
- 根事务拥有写入租约，session 与缓存按固定锁序协作。

## 链路

### 打开 ProjectSession

1. 目录打开编排请求打开目标 Mod。
2. 后端计算 canonical root 并校验 Mod 结构。
3. 读取来源记录及匹配版本，构造完整索引、统计与诊断并持久化来源成果。
4. 建立 session 与 manifest 并返回前端。
5. 前端 project store 注册 manifest 并水合活动运行态。

### 按需 query

1. 组件请求触发 ViewModel 调用所属实体、CSV、source、Hull 或资源能力。
2. 所属能力经 `command.runtime` 调用后端 session query。
3. 后端从懒加载缓存取数并返回实体与资源引用。
4. 前端写入按 session 隔离的查询缓存并驱动渲染。

### 写后失效

1. FIFO 事务写盘并登记文件历史、提交身份与实际版本。
2. 事务按路径归属定位已登记会话，构造受影响投影并发布会话更新。
3. receipt 返回 ready 投影或 `pending` 提交引用与结构化错误。
4. 前端接纳历史、manifest 与投影代次，先失效资源缓存再失效查询缓存。
5. 统一提交事件携带来源窗口、完整 receipt 与保存或回放原因，消费者按身份接纳。

### 提交恢复

1. 手动重试、再次保存或关闭交接取得所属待同步 receipt。
2. `pending` 投影经 `synchronize_committed_write` 消费后端登记的提交记录。
3. ready 投影进入本窗口接纳，完成状态推进至广播。
4. 广播成功释放前端 `pending`；失败保留当前步骤及 receipt。

### 关闭 session

1. Mod 移除或工作区关闭触发关闭请求。
2. 后端从注册表移除条目并释放资源。
3. 在途操作自然完成；后续进入的未知 session 请求被拒绝。
4. 前端按生命周期清理用例移除对应缓存与状态。

## 规范

- CSV 写后 refresh 必须保留当前缓存与 changeset after 文本一致的行身份和键分配序列；重新读取的外部版本必须按正式加载入口建立行身份。
- CSV 查询必须显式投影 `isComment` 与 `sourceRowIndex`；搜索必须消费 CsvSearchField，ID 必须归表注册的 entity_id_field，名称与标签必须分别归 name 与 tags。
- Core 弹体必须保留 Core 实际来源，同时必须声明当前 Mod 的覆盖创建目标；失效重建必须消费相同来源组合。
- ID 归属的实体视图、关联目标、来源目录、表计数、行预览与失效快照必须消费解析器 `isComment`；实体登记只允许枚举非注释且实体 ID 非空的行。
- Variant 与 Skin 必须分别持有索引和诊断，统计必须消费所属记录数量；manifest 诊断必须按 Variant、Skin 顺序聚合。
- Variant 与 Skin 的业务输出必须是文件内容；加载身份、文件目标、版本与资源必须分别归正式记录。
- `WriteResult` 必须携带 sessionUpdates；每项必须表达 `sessionId`、`modRoot`、`commitId` 与 ready 或 `pending`，ready 必须携带 manifest、invalidation 和 `projectionRevision`。
- detail、list 与编辑目标查询必须消费同一目标定义；规格目标必须承载实际来源、所属根、写入目标、加载身份及关联行。
- manifest 接纳必须核对 session 与单调投影代次，缓存失效与通知必须由项目同步按所属结果交付。
- `pending` 提交与前端同步登记必须保存稳定码、原始 message 与 nullable location，呈现必须消费所属文案投影。
- session 注册表只允许短暂访问句柄，锁序必须为根事务租约、session 状态与缓存；query 严禁写盘，write 必须更新现有会话投影。
- 会话与 Core CSV 缓存必须分别保存业务 data、`isComment` 与 `rowKey`，严禁覆盖文件中的同名业务键。
- 会话根入口必须只交付生命周期、授权、投影及缓存配置，严禁转导出查询、资源和业务保存函数。
- 写后失效对无法解析的实体只发出该实体种类的 `id: null` scope，严禁阻断其它实体或扩大失效范围。
- 初始化、缓存恢复和失效重建必须消费同一所属来源构造；每次投影中的受影响族必须去重且各构造一次。
- 多文件版本必须覆盖实际规格与所属 CSV、势力索引与授权规格、任务索引与任务目录；新建必须携带目标不存在凭据。
- 已写盘提交的投影恢复必须经所属 FIFO 根租约；正常 ready 结果只允许直接接纳，广播重试必须复用已完成投影。
- 已登记 session 必须保留至显式关闭；应用关闭必须占有新会话登记入口并等待已开始的建立动作；会话释放必须清理对应媒体缓存。
- 异步刷新提交必须验证捕获 session 和 `pending` 生命周期；已关闭 session 的响应严禁覆盖新会话 manifest。
- 所有 Mod 缓存与索引必须按 session 隔离，严禁跨 session 复用。
- 手动刷新必须按所属 Mod／Core 来源授权并保留 session 与 CSV 行身份；完整读取成功后必须更新正式投影和版本。
- 打开时必须取得全部索引来源的内容版本，业务投影必须消费匹配的来源记录。
- 投影 `pending` 期间的新查询必须返回 session.projection_pending，当前草稿与展示必须保留。
- 投影构造必须先完成全部受影响索引、诊断、统计与版本，再原子发布；失败必须保留原投影并登记 `pending`。
- 持久化索引只允许消费正式来源文件及匹配内容版本。
- 提交投影恢复必须消费会话读取归属；Core 写入授权必须归实际写盘和回放入口，投影恢复必须保持已提交内容。
- 来源刷新必须按捕获 session 的生命周期接纳正式投影、缓存失效与窗口通知，弹体引用目录必须消费已接纳规格的实际 Mod／Core 来源并随登记失效重读，页面必须分别判定所属展示的接纳权。
- 来源指纹、缓存恢复与目录加载必须经同一根边界授权实际文件及父链；索引引用必须纳入源指纹与版本范围。
- 缓存损坏或不可写只降级为重建，严禁读取旧快照。
- 编辑 query 必须随数据返回 `baseVersions`；派生信息刷新必须保留 CSV 行身份，内容刷新必须按实际写盘方向处理。
- 联合查询必须共同返回实际来源、授权目标与内容版本；联合 write 必须将同一次 changeset 的身份、行键与投影共同交给 receipt。
- 船体引用查询的指定 ID 结果必须包含内置武器槽目录，并按当前 Mod 优先、原版补集与皮肤继承规则计算。
- 重命名的失效必须同时携带旧 ID 与新 ID。
- 项目清单必须按明确 Mod 根查询，当前 Mod 选择与其清单、session 投影必须归工作区。
