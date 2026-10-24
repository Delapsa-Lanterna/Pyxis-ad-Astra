# CSV 文档编辑

## 定义

CSV 文档编辑模块管理整表文件的领域规则、运行态、展示、操作历史与关联保存。

## 参考

### 拥有

- `src-tauri/src/commands/tables.rs`：CSV 读取与 patch command。
- `src-tauri/src/domain/csv_column_order.rs`：CSV 标准列资产与补列排序，供联合 write 消费。
- `src-tauri/src/domain/spec_construction.rs`：关联规格创建构造与武器类型约束。
- `src-tauri/src/services/project/cache/csv.rs`：所属表格快照、稳定行身份、加载与刷新匹配。
- `src-tauri/src/services/project/definitions/table_definitions.rs`：表格实体列、摘要、图标及来源选项映射。
- `src-tauri/src/services/project/query/csv_window.rs`：CSV 窗口行、搜索与单行预览查询。
- `src-tauri/src/services/project/write/csv_first_save_tests.rs`：14 类 CSV 的表头来源与空表首次保存验证。
- `src-tauri/src/services/project/write/csv_patch.rs`：CSV patch、关联规格、行键及同根 changeset 装配。
- `src-tauri/src/services/project/write/csv_staging.rs`：CSV 表草稿、最终文本暂存及成功写盘后的会话接纳。
- `src/app/components/AssociatedSpecSaveDialog.vue`：关联规格选择与武器创建类型的异步确认内容。
- `src/app/components/csv-editor/`：按需挂载表格、单元格输入、行详情及其行为测试。
- `src/app/composables/csv-editor/`：CSV 查询、输入、动作装配与保存参与者。
- `src/domain/csv-editor/`：表格草稿、操作历史、关联规格及展示投影。
- `src/orchestrators/csv-save.orchestrator.ts`：保存编排，以 `saveCsvChanges` 拥有明确 Mod／表的输入提交、快照捕获、关联选择、写入与 receipt 接纳。
- `src/services/csv-table.service.ts`：窗口、行预览、资源装配和关联实际目标准备。
- `src/stores/csv-editor.store.ts`：表格运行态，拥有窗口行、选择、dirty、当前表与保存中状态；`initializeModTables` 按 session、Mod 和 manifest 一次建立表格状态与输入集合。

### 消费

- `src-tauri/src/models/table_save.rs`：CSV 保存请求、行修改、关联规格动作与写入目标。
- `src-tauri/src/models/tables.rs`：CSV 查询请求、解析记录、搜索与窗口结果。
- `src-tauri/src/services/project/sources/`：表格消费的带版本读取与已解析内容交接。
- `src/domain/csv-editor/csv-dirty.ts`：保存快照消费的表格行脏标记。
- `src/domain/csv-editor/csv-table-draft.ts`：提交后的表格基线、行序、行键映射及 dirty 接纳。
- `src/domain/edit-session.ts`：历史双栈原语。
- `src/domain/schema/csv-schema-registry.ts`：表格消费的列 schema 加载入口。
- `src/orchestrators/edit-target-handoff.orchestrator.ts`：消费所属 CSV 保存参与者、短暂表锁与写结果。
- `src/orchestrators/project-sync.orchestrator.ts`：表格保存消费的 receipt 同步与反馈入口。
- `src/shared/lib/starsector/rows.ts`：表格行显示标识与关联规格标识。
- `src/shared/lib/starsector/tables.ts`：游戏表格标准列、模块名称及列排序。
- `src/shared/types/csv-table-history.types.ts`：CSV 草稿操作及历史条目协议。
- `src/shared/types/table-save.types.ts`：CSV 保存请求、行修改、关联规格动作及正式写入目标契约。
- `src/shared/types/tables.types.ts`：CSV 行、单元格目标、窗口与预览契约。
- `src/shared/types/write-commit.types.ts`：公共保存回执、提交同步、行键映射与 JSON 写入契约。
- `src/stores/project.store.ts`：指定 Mod 的正式清单与 session 查询，异步动作消费捕获目标。
- `src/stores/workspace.store.ts`：当前 Mod、清单与 session 投影，以及按 Mod、表与列持有的持久化列宽。
- `src/test/csv-input-host.ts`：CSV 输入提交的组件测试宿主。
- `src/test/csv-row.ts`：CSV 草稿行的测试构造。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。
- `src/orchestrators/main-history-command.orchestrator.ts`：当前表格输入提交与表格历史分派。
- `src/orchestrators/settings-persistence.orchestrator.ts`：历史容量同步。
- `src/orchestrators/workspace-lifecycle.orchestrator.ts`：所属 Mod 的草稿历史释放。

### 关联

- `scripts/performance/csv-rendering.mjs`：真实 EXE 的首次进入、切表、滚动、字段完整性与绘制完成计时。
- `src-tauri/src/services/project/write/entity_description.rs`：舰船与武器描述行的身份改名和同根暂存。
- `src-tauri/src/services/project/write/ship_description_tests.rs`：舰船身份与描述行联合更新的集成验证。
- `src-tauri/src/services/project/write/weapon_description_tests.rs`：武器身份与描述行联合更新的集成验证。
- `src-tauri/src/services/write_transactions.rs`：根写入租约、版本复核、历史登记、回放及投影提交。
- `src/orchestrators/csv-save.orchestrator.spec.ts`：保存编排行为测试。
- `src/shared/lib/starsector/index.ts`：游戏值、颜色与表格规则的转导出入口。
- `src/shared/lib/starsector/value.ts`：JSON 复制、标量转换与 Mod 版本展示。
- `src/shared/types/json.types.ts`：JSON 业务值与输入形状契约。

## 边界

- ViewModel 拥有窗口接纳、搜索和过滤，workspace 提供活动身份。
- 保存归表格编排，草稿撤销重做归所属表运行态，身份交接锁由所属运行态提供。
- 列语义来自 schema 加载器，持久化列宽归 workspace 的 Mod、表、列上下文。
- 双栈结构消费编辑会话原语，CSV 操作反演、行数和行序维护归表格领域。
- 后端返回窗口行、来源位置与 `rowKey`，CSV store 持有行草稿、选择、dirty 和保存状态。
- 控件拥有原文，表输入集合拥有登记与提交，单元格动作以完整 `CsvCellTarget` 交付草稿历史。
- 文件历史维护已写盘 changeset，表格历史维护内存中的 CSV operation。
- 网格拥有可视窗口、列宽交互与渲染，选中样式消费响应式 `selectedRowKey`。
- 行业务 data、`isComment` 和 `rowKey` 分别表达，来源位置与当前显示位置分别投影。
- 表格运行态与输入集合由 `initializeModTables` 按 session、Mod 和 manifest 建立。

## 链路

### 打开表格窗口

1. 表格进入时按需请求当前表的首批行，并在可视区及提前量范围内继续读取。
2. ViewModel 按完整目标接纳列宽并处理所属草稿保护。
3. CSV 读取能力装配 query identity 与 command，后端返回窗口与源索引。
4. store 按捕获目标写入行、表头与总数，网格按可视区调度并保留已挂载行。

### 编辑单元格

1. 用户激活单元格，所属输入集合提交前一个编辑动作。
2. tables 记录完整活动身份，网格挂载对应编辑控件。
3. 控件登记原始输入并按列 schema 选择输入、选择器或引用选择。
4. 提交经目标化单元格变更边界写入行值并登记一次历史。
5. 已提交行差异进入行脏标记，活动输入差异进入表与 Mod 未保存判定。

### 选择行

1. 用户点击行触发选择事件。
2. store 按捕获 Mod 与表更新 `selectedRowKey`。
3. 行组件按响应式选中态渲染高亮，右侧详情同步刷新。

### 过滤与搜索

1. 用户输入搜索文本或切换 ID/名称、ID、名称、tags 搜索项。
2. ViewModel 提交所属输入并复核目标，更新所属搜索文本与搜索项。
3. 查询接纳消费草稿与活动输入保护状态。
4. 全部行被过滤或无可显示列时显示对应说明。

### 草稿撤销与重做

1. 当前表格输入提交后，主窗口或工具栏消费对应 Mod 和表的历史操作。
2. 表格草稿领域按 undo 或 redo 方向应用 operation，更新内容、dirty、顺序、计数和选择。
3. 成功后所属表运行态 将同一条目转移到对应双栈。

### 保存与生命周期

1. 表格保存编排捕获本次提交前的 undo 与 redo 条目身份。
2. 实际写盘后，表格领域接纳提交基线并应用后端行键映射。
3. 表格历史同步行键，清理捕获条目并保留保存期间的新操作。
4. 设置更新同步容量，所属 Mod 释放清理全部表格历史。

### 捕获保存目标

1. 用户触发页头或 Ctrl+S，所属表与 session 进入主窗口共同保存队列。
2. 轮到执行时，编排捕获完整目标并持有准备与保存状态。
3. 所属输入集合逐项提交原始输入，编排复核目标、session 与 tables 状态。
4. 编排捕获独立 patches、版本凭据、关联候选与历史身份集合。

### 提交保存

1. 目标为空或已有表无 dirty 时返回 noop；缺表首次保存消费已有准备表头；同文档的排队及进行中保存由同一请求表达。
2. app 层选择回调按需加载确认内容，经所属反馈入口展示快照中的关联候选与创建类型，返回选定动作或取消。
3. 编排复核目标并消费同一快照中的 patches、关联动作与版本。
4. 调用排他写提交 patches 与关联动作。
5. 后端校验 session/root 与关联种类，按创建参数构造规格或解析已有来源更新 ID，构建并应用原子 changeset。
6. 返回写结果、`rowKey` map 与结构化失效。

### 保存后接纳

1. session 已变化时保留 dirty 并返回 saved，不做本地提交。
2. 将提交 patches 和返回版本共同接纳到 original 基线。
3. 将当前行、编辑目标与草稿历史映射到保存后的 `rowKey`，按该基线重算 dirty。
4. 完整 receipt 进入统一接纳入口，投影历史、会话更新及缓存并发送提交通知。
5. 所属保存回执完成同步后反馈一次成功；同步失败保留该回执及已接纳基线，重试继续同步。

## 规范

- 14 类 CSV 缺表必须依次采用 Core 表头与对应 schema 列；已有文件必须消费自身表头；打开页面只允许读取；首次保存必须支持只有表头的空文件。
- CSV native 输入必须逐字符保留空串、前导零与数字表示，领域转换必须归所属消费者。
- CSV patch 保存必须原样保留文件自身表头与列集；联合字段补列必须消费明确提交意图及标准列顺序，全部 CSV 保存必须保留行序、注释身份、未知列与业务内容，并以真实格式测试验收。
- CSV patch 必须携带读取基线与 `isComment`，恢复行必须携带 `insertAt`；正式 `rowKey` 删除必须命中实际行，未知键必须返回冲突。
- CSV 保存参与者必须交付所属表草稿与现有输入集合；窗口关闭必须经保存注册表核对目标、草稿、dirty 与输入生命周期。
- CSV 保存必须消费正式 parser 的列数容忍、注释和空行模型，渲染必须使用最小引号规则及 LF 行。
- CSV 保存状态、行、基线、顺序、计数、输入及 operation 历史必须归所属表运行态；文档动作与保存参与者必须按 session、Mod 与表各装配一次。
- CSV 文档动作必须交付完整目标、输入、dirty、保存状态、保存与等待能力、历史能力及撤销重做结果；主窗口必须消费所属动作。
- CSV 新增行的 `insertAt` 必须将省略与 `null` 共同解释为末尾插入；显式位置必须沿现有插入规则处理。
- CSV 暂存必须共同交付表身份、表头、行、分配序列及最终文本；正式表状态只允许在同根 changeset 应用成功后消费该暂存结果。
- CSV 最终行序必须在同一保存快照中捕获，源位置与新增行键必须在版本校验后解析；顺序必须完整、唯一且覆盖保存后的全部记录，内容与行序必须进入同一次文件历史。
- CSV 窗口版本范围只允许包含表文件，关联规格版本必须由本次选择的保存目标独立交付。
- CsvGridCell 必须直接持有所属内容容器及浮层锚点引用，活动编辑与静态展示必须消费同一单元格边界。
- Esc 必须取消本次输入；文本浮层、native 输入与选择器必须共用所属集合的保存提交入口。
- limit 必须由设置的 `editHistoryLimit` 统一输入；初始化、设置变化与窗口镜像必须立即同步现有栈容量。
- native 文本、多行浮层与多选必须在一次编辑动作结束时产生一条前后值操作；原始输入期间只允许登记待提交状态。
- upsert patch 必须构造提交时的独立行快照，业务内容只允许从行记录 data 独立克隆，恢复位置必须从 `insertAt` 装配。
- upsert 的注释标记必须与业务快照共同固定并更新实际基线；关联规格候选必须消费原始行及当前行的正式注释身份。
- 下划线开头的文件列必须按普通业务列显示、编辑和保存；行身份只允许消费记录的 `rowKey`。
- 业务 CSV 字段必须归 `CsvDraftRow.data`；`rowKey`、`sourceRowIndex` 与 `insertAt` 必须分别归所属行记录，严禁写入业务字典。
- 保存入口必须显式接收 manifest 与 table，结果必须共同表达 status 与已写盘 receipt；关联表准备必须复用该动作。
- 保存快照必须在活动输入提交后、关联选择前固定；patches、关联行内容、版本与历史捕获必须属于同一次提交。
- 保存映射必须同步 operation.rowKey 与行记录身份；来源位置与恢复插入位置必须分别交接。
- 保存期间撤销已提交删除时必须分配 new 行身份并保留原插入位置；当前行、编辑目标和 undo/redo 操作必须同步应用身份映射。
- 保存期间的查询与自身失效必须保留前端草稿；写后 refresh 必须保留与已写盘 after 快照相符的后端行身份。
- 保存期间的表格失效必须合并为后续权威读取；查询必须共同比较原始行基线与版本，自身保存回声只允许更新所属投影。
- 保存状态必须覆盖整个提交窗口，同一编辑器重复触发必须保持当前请求；跨窗口请求必须进入后端队列。
- 保存行序接纳必须以提交顺序重建源位置，并共同映射当前草稿、输入身份与保留历史；保存期间的新内容、增删及历史回放结果必须保留。
- 保存请求期间的新编辑必须保留，original 必须以实际提交 patches 更新，dirty 必须按该基线重算。
- 关联 spec 动作必须与 CSV 变更构成同一次原子 changeset，严禁分次写入。
- 关联 spec 改名必须按本次 `preserveOriginalJson` 设置更新旧文件文本；需要整体重排时必须在 CSV 与 spec changeset 应用前确认。
- 关联候选列表必须在当前窗口内独立滚动，确认与取消必须保持可操作。
- 关联创建必须携带所属格式的创建参数；删除必须携带 ID，重命名必须携带原 ID 与目标创建参数。
- 关联目标与版本必须在确认前捕获；正式提交必须携带 `AssociatedSpecWrite` 的动作与实际 `EntityEditTarget`。
- 关联确认必须提供 projectile 与 beam 调整入口，不提供 pulse 入口。
- 关联规格身份交接期间必须保持所属表锁；写盘 receipt 接纳后必须交接行基线并清理该表已提交操作历史。
- 关联选择必须由 app 层提供可等待回调，取消必须结束准备状态；同一保存面重复触发必须复用进行中的请求。
- 再次保存必须先重试所属待同步 receipt；恢复成功后必须提交当前输入并捕获新快照，空闲保存必须保持即时捕获顺序。
- 列宽覆盖与测量锁定必须绑定 session、Mod 与表；目标变化必须先接纳所属列宽再处理 dirty 与读取。
- 列宽调整必须即时反映渲染宽度并进入持久化投影。
- 删除 patch 必须携带删除动作标记，严禁以空 upsert 表达删除。
- 前端新增行只允许使用临时 new key，保存后以后端 `rowKey` map 替换。
- 单元格操作必须捕获 `previousIsComment` 与 `newIsComment`；首列表头字段的回放必须接纳捕获标记，严禁从解析后的字符串重算原始引号语义。
- 单元格编辑必须在动作提交边界一次性写值与登记历史；中间输入必须参与未保存判定，行脏标记只允许表达已提交行差异。
- 历史栈严禁持久化，仅在内存按会话存在。
- 同值同版本的窗口接纳必须按 `rowKey` 更新来源位置投影，并保留正式草稿、dirty 与活动输入。
- 后台 CSV 交接必须消费捕获 manifest 与 table 的正式保存动作；联合规格装配必须复用身份规则并在实际 changeset 完成后发布行状态。
- 固定枚举选项必须与目标 Starsector 版本的加载器枚举完全一致。
- 媒体需求必须由可视范围、邻近范围、来源索引、相关字段值与编辑模式驱动，并复用正式预加载、失效与释放流程。
- 工具栏撤销与重做必须先交接活动输入；原生输入焦点内的快捷键必须保留文本撤销语义。
- 已有来源的保存、删除与改名必须消费实际已加载路径；改名必须保留原目录，来源缺失必须消费所属默认创建构造。
- 已有来源重命名必须保留全部业务内容并更新 ID；来源缺失的创建必须消费共享模板与目标创建参数。
- 当前展示目标必须消费工作区的当前项目投影，异步动作必须捕获并持续消费所属 Mod 根与 session。
- 拖动必须先提交所属活动输入，校验失败必须保留输入原文、焦点与目标；一次放下必须只提交一次行移动。
- 拖动必须归网格实例，指针取消、Escape、目标变化、基线交接及卸载必须释放所属捕获、插入目标与帧循环。
- 搜索关键词去除首尾空白后非空时必须禁用行排序；搜索项与空关键词组合必须保留排序能力，身份交接及数据准备期间必须禁用拖动。
- 搜索必须去除首尾空白并忽略大小写进行包含匹配；空关键词必须返回全部行，注释行必须按所属业务字段参与搜索。
- 搜索输入必须支持回车确认目录选项或录入新值；候选目录必须复用搜索文字与名称索引，按钮与文字必须完整创建，选中变化必须只更新所属候选；数字模板必须填入同一搜索栏，多选必须以整个编辑动作一次提交。
- 搜索项切换必须保留关键词并提交活动输入；同 Mod 切表必须恢复 id-name 并清空关键词，返回同一当前表必须保留搜索上下文。
- 搜索项必须由当前权威表头投影；组合项只允许匹配所属 ID 列与 name，单字段项只允许匹配所属字段，缺失字段严禁匹配。
- 操作必须携带足以反演的前后值，严禁保存整表快照。
- 新动作必须清空 redo；limit 只裁剪 undo 侧。
- 新建、删除及其 undo/redo 必须经同一行变更边界维护虚拟表的 total/filtered 行数。
- 新建行必须插在当前选中行下方并成为选中行；无选中行时必须追加至表尾；筛选与窗口化必须按源文件位置保存插入顺序，连续新建、删除及撤销重做必须保持实际行序。
- 未保存行序进入有效搜索前必须提供保存、放弃当前表全部修改与取消；保存成功且所属草稿清理后才允许搜索，搜索交接必须串行并核对所属目标与请求代次。
- 查询窗口必须提供实际 `sourceRowIndex`；网格 rowIndex 只允许表达当前显示位置。
- 横向可视列必须保留原始列位置并提前准备左右各一列，活动编辑列及其输入锚点必须持续驻留。
- 武器 CSV 关联改名必须共同提交实际规格与所属 `WEAPON` 描述 ID；描述目标占用必须拒绝全部关联 changeset。
- 武器初始分支必须按 10 项 projectile 字段与 3 项 beam 字段的非空原文计分；零值必须计分，平分必须选择 projectile。
- 滚动、单元格切换与窗口化替换必须先提交所属输入；同目标模型更新必须保持控件，`rowKey` 映射必须保留活动输入的归属。
- 界面刷新必须由所属根登记实际来源与动作，并沿现有保存等待、草稿和外部更新接纳流程执行。
- 窗口读取必须捕获 session、Mod、表、搜索文本、搜索项、状态实例与读取代次；本地动作、保存、重载和卸载必须撤销较早响应与错误的接纳权。
- 结构化失效必须由后端从同一 changeset 推导，严禁前端拼装失效路径。
- 缺失列 schema 的列只做文本编辑，严禁猜测控件类型。
- 联合字段补列必须消费 Core 权威表头或正式列资产；全部标准列必须按来源排序，自定义列必须保留内容与相对顺序。
- 舰船关联改名必须依据原规格的 `descriptionId` 声明决定默认描述行交接；默认描述 ID 更新必须共同进入 CSV 与规格事务、历史及结构化失效。
- 草稿与 dirty 单元格字典必须保留全部自有列键；缺失列必须以空值展示，严禁消费对象原型上的属性。
- 行创建与删除操作必须捕获独立 `CsvDraftRow`，业务内容与工具元数据必须共同参与回放。
- 行序差异必须参与表格与 Mod 未保存判定，恢复已接纳顺序必须清除对应行序差异；创建、删除、移动及回放必须共同维护顺序序列与选中身份。
- 行移动必须捕获稳定行键与移动前后位置，普通行、注释行及空白记录必须各自独立移动；原位放下必须按无变化处理。
- 行预览必须消费捕获的 session、表和 `rowKey`，目标变化及卸载必须释放等待；资源或行预览失效必须合并后读取当前目标。
- 表格窗口、来源集合与行预览必须分别经所属通道接纳结果和错误；来源集合必须在全部目录返回后共同发布。
- 表格窗口必须按可视区及上下各一个视口的提前量请求行，严禁一次加载全表。
- 表格缩略图必须由网格管理可见与邻近资源集合；行组件首次进入提前量时挂载，单批必须最多挂载四行并在组件更新后复核 4ms 调度预算；已访问行必须在当前表内持续驻留，切表、目标替换或卸载时释放所属展示引用与输入登记。
- 表格身份释放事件必须按原请求的 session 和 Mod 核对当前会话；回执只允许更新所属行与基线，会话重开后必须仅释放原锁。
- 表运行态只允许接纳所属 CSV 的基线版本；规格版本必须归关联保存快照与实体记录。
- 表锁必须覆盖提交与本地 receipt 接纳；锁定期间必须保持读取接纳与编辑动作归属，失败、窗口销毁和会话结束必须释放锁。
- 规格保存前必须提交并保存所属 CSV 草稿；取消或失败必须保留规格编辑面，完成准备后必须锁定所属表。
- 视口尺寸与滚动位置必须在挂载、尺寸变化及合并后的滚动事件中统一接纳，媒体准备必须消费已接纳的视口状态。
- 选择、编辑与 dirty 只允许消费正式行，严禁把虚拟间隔和占位作为业务记录。
- 选择与文本浮层必须共用视口计算；浮层宽度与水平位置必须服从当前窗口，resize 监听必须随控件释放。
- 顺序草稿必须通过基线源位置与新增行键表达，窗口读取必须映射实际源区间并按当前顺序接纳；同基线的新窗口必须保留已编辑行，外部基线必须进入更新保护。
- 首列变化必须按正式注释身份装配标记；文字值以 # 开头的业务行必须保留字面内容和必要引号。

## 陷阱

- `src/shared/runtime/app-log-queue.ts`：行实际挂载、输入提交及驻留生命周期的详细记录。
- 用 DOM class 维护选中会让虚拟滚动后高亮错位。
- 用数组索引定位行会让排序、过滤与删除后写错行。
- 直接把过滤后行数组当作编辑数据源会让 dirty 写到不可见行。
- 缺失列 schema 时启用引用或枚举控件会让无来源列发起空查询。
- 让编辑控件直接调用保存会让局部输入绕过 dirty 与历史链路。
