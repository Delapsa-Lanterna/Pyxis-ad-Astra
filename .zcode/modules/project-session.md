# 项目会话与正式内容

## 定义

项目会话与正式内容模块管理已打开 Mod 的生命周期、清单与正式内容的原子接纳。

## 参考

### 拥有

- `src-tauri/src/domain/entity_definitions.rs`：八种实体的目录、后缀、ID 字段及规格、表格关联登记。
- `src-tauri/src/domain/entity_identity.rs`：跨编辑器实体 ID、路径与来源范围纯规则。
- `src-tauri/src/services/project/definitions/entity_definitions.rs`：实体来源、读取准备、刷新与摘要的登记规则。
- `src-tauri/src/services/project/definitions/factions.rs`：势力蓝图标签推导。
- `src-tauri/src/services/project/definitions/mod.rs`：实体来源与资源定义的模块登记。
- `src-tauri/src/services/project/definitions/projectiles.rs`：Mod 弹体及 Core 回退的正式读取。
- `src-tauri/src/services/project/invalidation.rs`：提交路径到会话正式内容、实体与资源失效的更新。
- `src-tauri/src/services/project/mod.rs`：会话生命周期、授权、内容更新、缓存配置与性能入口。
- `src-tauri/src/services/project/model.rs`：会话、引用视图、可编辑 CSV 行身份及表格业务元数据。
- `src-tauri/src/services/project/query/json_layers.rs`：同路径有序来源、匹配版本及正式来源组合读取。
- `src-tauri/src/services/project/query/mod.rs`：只读业务实现的服务层可见模块登记。
- `src-tauri/src/services/project/root.rs`：任务索引统计行为验证。
- `src-tauri/src/services/project/session.rs`：会话打开、关闭、内容更新与内部登记及就绪访问能力交付。
- `src-tauri/src/services/project/session/access.rs`：捕获引用快照后锁定并交付所属就绪会话。
- `src-tauri/src/services/project/session/csv_tables.rs`：正式表格内容、稳定行身份、来源保留、加载版本及实体计数构建。
- `src-tauri/src/services/project/session/csv_writes.rs`：表格写入缓冲、最终文本与实际应用后的正式状态接纳。
- `src-tauri/src/services/project/session/references.rs`：有序引用来源、代次、共享快照与按需表格视图。
- `src-tauri/src/services/project/session/registry.rs`：会话存活登记、句柄与内容就绪门控。
- `src-tauri/src/services/project/session/source_refresh.rs`：同根正式候选构造、手动及自动来源接纳、缺失路径与 Core 会话更新。
- `src-tauri/src/services/project/session/source_versions.rs`：会话来源复用、完整项目及变化来源版本范围交接。
- `src-tauri/src/services/project/test_support.rs`：项目测试工作区的会话、历史及 Core 缓存释放与异常退出验证。
- `src-tauri/src/services/project/versions.rs`：会话已接纳来源的路径凭据投影。
- `src-tauri/src/services/project/write/mod.rs`：写入业务实现登记及内部暂存入口。
- `src-tauri/src/services/project_session.rs`：游戏根与 Mod 根授权、来源输入准备及会话范围核对。
- `src/domain/project/entity-versions.ts`：保存目标版本捕获与关联表凭据交接。
- `src/domain/project/query-scopes.ts`：标准实体失效 scope 的种类、ID 与通配匹配。
- `src/services/project-readiness.service.ts`：窗口内按 session 维护正式内容读取门控。
- `src/services/project-session.service.ts`：session 打开协议。
- `src/stores/project.store.ts`：按 Mod 根管理全部 manifest、session 查询、表格写入目标与正式清单。

### 消费

- `src-tauri/src/app_data_dir.rs`：持久化来源索引所属的工具私有目录解析。
- `src-tauri/src/domain/json_composition.rs`：正式来源组合消费的游戏 JSON 纯规则。
- `src-tauri/src/models/collections.rs`：内容更新和失效范围的稳定去重追加。
- `src-tauri/src/models/mod.rs`：正式模型登记及聚合导出。
- `src-tauri/src/models/project_identity.rs`：会话、实体、表、资源、目标及版本身份与 session 范围实现宏。
- `src-tauri/src/models/project_session.rs`：会话请求、清单、摘要与正式失效结果。
- `src-tauri/src/models/serde_fields.rs`：会话输入字段的空值转换与非空字符串归一化。
- `src-tauri/src/services/project/query/entities.rs`：实际实体详情与列表查询。
- `src-tauri/src/services/project/query/entity_targets.rs`：实体查询交付实际编辑目标、身份意图与版本范围。
- `src-tauri/src/services/project/sources/`：成套来源内容、版本与解析成果读取。
- `src/domain/project/entity-definitions.ts`：共享实体内容 ID 字段、可用 ID 规则与目标身份投影。
- `src/services/entity-query.service.ts`：实体查询能力交接。
- `src/shared/types/project-identity.types.ts`：会话、实体、表、资源与文件版本身份的基础协议。
- `src/shared/types/project-session.types.ts`：会话请求、清单、摘要与正式失效结果。
- `src/shared/types/write-commit.types.ts`：公共保存回执、提交同步、行键映射与正式内容交付。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。
- `src-tauri/src/services/project_sync.rs`：首次来源读取前的监听订阅及基线登记后的激活。
- `src/orchestrators/project-sync.orchestrator.ts`：窗口内投影接纳、缓存失效、提交恢复及通知装配。

### 关联

- `src/shared/lib/paths.ts`：文件系统、资源及游戏目录的路径纯规则。

## 边界

- session 注册表持有授权根与会话 handle，各会话状态分别加锁。
- 关闭移除登记，已取得 handle 的在途操作自然完成，后续操作以未知 session 拒绝。
- 前端 project store 持有全部 manifest 和正式清单，工作区按根查询，项目同步顺序交付完整正式内容。
- 势力及蓝图包提供 tags 元数据，来源变化参与全部相关表的失效。
- 后端 query 消费会话索引并返回只读结果，write 发布 changeset 和结构化内容更新。
- 正式会话内容不消费资源投影；资源与实体呈现消费正式内容及来源。
- 正式 CSV 定义、内容、稳定行身份、来源版本、缺失来源保留及实体计数归会话表格能力。
- 实体列表以 EntityListEntry 交付种类、身份和内容，资源映射由所属消费者调用资源能力。
- 正式 JSON 来源按当前会话的原版、前序引用和本地内容组合，内容及来源版本由同一来源结果交付。
- 表格写入缓冲持有候选行和最终文本，实际变更集应用成功后由会话能力接纳正式状态。
- 媒体和查询等待按 session 释放，正式内容恢复归事务与提交同步入口。
- 持久化来源成果由来源读取交付，query 消费所属会话正式内容。
- 来源目录、实体记录和草稿资源由后端定义装配，配置变化交付实际资源范围，候选读取能力拥有配置候选的失效解释。
- 引用来源层消费工作区发布的标签顺序，为同路径文件组合交付当前会话之前的可引用来源，JSON 查询消费该序列。
- 根事务拥有写入租约，session 与缓存按固定锁序协作。
- Mod 来源的手动与自动刷新共用根级来源比较及正式接纳；目录批次与完整重扫核对现存文件及已登记缺失路径，按指纹差异确定刷新范围。
- 同批 Mod 来源刷新复用暂存字节与缺失版本，重叠路径按父目录合并；刷新范围确定后构造同根候选，全部候选完成后统一接纳。

## 链路

### 打开 ProjectSession

1. 工作区打开编排请求打开目标 Mod。
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

1. FIFO 事务写盘并登记文件历史与实际文件凭据。
2. 事务按路径归属定位已登记会话并构造受影响正式内容。
3. 保存工作在正式内容准备完成后返回完整结果并发布更新。
4. 前端按有序交付接纳历史及 manifest，先失效资源缓存再失效查询缓存。
5. 统一结果携带来源窗口、完整内容与保存或回放原因。

### 提交恢复

1. 已写盘保存工作持有尚未完成的正式内容登记。
2. 手动重试继续所属会话登记，已完成会话释放其执行位置。
3. 完整正式内容随保存结果发布并结束项目保存工作。
4. 消费者独立处理必要读取、错误和自身释放。

### 关闭 session

1. 项目同步请求注册表原子注销，注册表交付最后同根注销的已登记根。
2. 项目同步释放所属历史，再调用会话内容清理释放媒体并更新引用状态。
3. 在途操作自然完成；后续进入的未知 session 请求被拒绝。
4. 前端按生命周期清理用例移除对应缓存与状态。

## 规范

- 会话注册表必须在同一锁内移除登记并核对同根剩余 session，历史释放由项目同步消费注销结果。
- 表格路径、身份列、摘要来源与 Core 要求必须消费唯一正式表定义，正式表状态严禁依赖 CSV 编辑实现。
- 实体定义必须分别登记默认目录与来源目录；默认目录用于新建目标，全部来源目录共同参与首次装载、刷新、版本捕获与实体失效。
- 引用来源必须来自已打开会话，来源快照在锁定接收方前取得，只读视图按引用范围版本共享，严禁交叉持有多个会话的可变锁。
- 会话存活与内容就绪必须归会话登记维护，引用来源交付独立快照，会话读取先捕获引用快照再锁定接收方并交付就绪内容。
- 会话建立必须消费统一原版根解析结果；`manifest.starsectorRoot` 与 `coreAvailable` 表达该会话实际采用的原版来源及可用性。
- CSV 写后 refresh 必须保留当前缓存与 changeset after 文本一致的行身份和键分配序列；重新读取的外部版本按正式加载入口建立行身份。
- CSV 查询必须显式投影 `isComment` 与 `sourceRowIndex`；搜索消费 CsvSearchField，ID 归表注册的 entity_id_field，名称与标签分别归 name 与 tags。
- Core 弹体必须保留 Core 实际来源，同时声明当前 Mod 的覆盖创建目标；失效重建消费相同来源组合。
- ID 归属的实体视图、关联目标、来源目录、表计数、行预览与失效快照必须消费解析器 `isComment`；实体登记只允许枚举非注释且实体 ID 非空的行。
- Variant 与 Skin 的业务输出必须是文件内容；加载身份、文件目标、版本与资源分别归正式记录。
- detail、list 与编辑目标查询必须消费同一目标定义；规格目标承载实际来源、所属根、写入目标、加载身份及关联行。
- session 注册表只允许短暂访问句柄，锁序必须为根事务租约、session 状态与缓存；query 严禁写盘，write 更新现有会话正式内容。
- 会话 CSV 必须保存稳定行键、业务 data 与 `isComment`，Core 来源交付只读解析行；业务内容中的同名字段保留。
- 会话根入口必须只交付生命周期、授权、内容更新及缓存配置，严禁转导出查询、资源和业务保存函数。
- 写后失效对无法解析的实体只发出该实体种类的 `id: null` scope，严禁阻断其它实体或扩大失效范围。
- 初始化、缓存恢复和失效重建必须消费同一所属来源构造；每次内容更新中的受影响族去重且各构造一次。
- 多文件版本必须覆盖实际规格与所属 CSV、势力索引与授权规格、任务索引与任务目录；新建携带目标不存在凭据。
- 任务来源凭据必须共同覆盖目录、索引、描述文件和正文，明确确认的缺失文件参与目录内容核对。
- 已读取编辑目标必须归当前会话登记，外部来源缺失保留正式路径，已执行删除及改名释放原目标登记。
- 已写盘提交的正式内容恢复必须经所属 FIFO 根租约；正常 ready 结果只允许直接接纳，窗口交接重试继续尚未完成的处理。
- 已登记 session 必须保留至显式关闭；应用关闭占有新会话登记入口并等待已开始的建立动作；会话释放清理对应媒体缓存。
- 会话注销必须消费登记的项目身份并交付最后同根事实；内容释放由完整项目释放调用，目录缺失时保留释放依据。
- 所有 Mod 缓存与索引必须按 session 隔离，严禁跨 session 复用。
- 手动刷新必须按所属 Mod／Core 来源授权并保留 session 与 CSV 行身份；完整读取成功后更新正式内容和版本。
- 同根外部批次必须先完成全部候选内容再统一接纳；文件与父目录刷新共同保留已加载缺失 CSV 的完整内容和行身份。
- 正式内容 `pending` 期间的新查询必须返回 session.content_pending，当前草稿与展示保留。
- 正式内容构造必须先完成全部受影响索引、诊断、统计与版本，再原子发布；失败保留原正式内容并登记 `pending`。
- 来源指纹、缓存恢复与目录加载必须经同一根边界授权实际文件及父链；索引引用纳入源指纹与版本范围。
- 编辑 query 必须随数据返回 `baseVersions`；派生信息刷新保留 CSV 行身份，内容刷新按实际写盘方向处理。
- 船体引用查询的指定 ID 结果必须包含内置武器槽目录，并按当前 Mod 优先、原版补集与皮肤继承规则计算。
- 重命名的失效必须同时携带旧 ID 与新 ID。
