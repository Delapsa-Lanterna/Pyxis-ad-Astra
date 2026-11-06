# CSV 文档编辑

## 定义

CSV 文档编辑模块管理整表文件的领域规则、运行态、展示、操作历史与关联保存。

## 参考

### 拥有

- `src-tauri/src/commands/tables.rs`：CSV 读取与 patch command。
- `src-tauri/src/services/project/query/csv_validation.rs`：校验所需的有效实体、引用候选、图片、脚本条目及类别效果来源读取。
- `src-tauri/src/services/project/query/csv_window.rs`：CSV 窗口行、搜索与单行预览查询。
- `src-tauri/src/services/project/write/csv_patch.rs`：CSV patch、关联规格、行键及同根 changeset 装配。
- `src/app/components/AssociatedSpecSaveDialog.vue`：关联规格选择与武器创建类型的异步确认内容。
- `src/app/components/csv-editor/`：按需挂载表格、单元格输入、行详情及其行为测试。
- `src/app/composables/csv-editor/`：CSV 查询、输入、动作装配与保存参与者。
- `src/domain/csv-editor/`：表格草稿、操作历史、关联规格及展示投影。
- `src/orchestrators/csv-save.orchestrator.ts`：保存编排，以 `saveCsvChanges` 拥有明确 Mod／表的输入提交、快照捕获、关联选择、写入与 receipt 接纳。
- `src/services/csv-table.service.ts`：窗口、行预览、资源装配和关联实际目标准备。
- `src/stores/csv-editor.store.ts`：表格运行态，拥有窗口行、选择、dirty、当前表与保存中状态；`initializeModTables` 按 session、Mod 和 manifest 一次建立表格状态与输入集合。

### 消费

- `src-tauri/src/domain/csv_column_order.rs`：字段模式所属的标准列与补列顺序。
- `src-tauri/src/models/table_save.rs`：CSV 保存请求、行修改、关联规格动作与写入目标。
- `src-tauri/src/models/tables.rs`：CSV 查询请求、解析记录、搜索与窗口结果。
- `src-tauri/src/services/project/model.rs`：正式表格路径、身份列、摘要来源与 Core 要求。
- `src-tauri/src/services/project/query/entities.rs`：按正式来源、目标及组合规则交付校验实体内容。
- `src-tauri/src/services/project/query/source_catalog/values.rs`：校验消费的完整引用候选。
- `src-tauri/src/services/project/resources/table_references.rs`：行预览与来源选项的授权图片及显示名称。
- `src-tauri/src/services/project/session/csv_tables.rs`：正式表格内容、稳定行身份与来源版本。
- `src-tauri/src/services/project/session/csv_writes.rs`：表格暂存与成功应用后的正式状态接纳。
- `src-tauri/src/services/project/write/entity_write.rs`：实体关联规格与描述的实际文件写入。
- `src-tauri/src/services/project/write/entity_write/associated_spec_preparation.rs`：关联文件实际来源、目标准备与匹配版本。
- `src/app/composables/csv-editor/csv-editor-context.ts`：表格目标、清单、列宽及实体定位的宿主契约。
- `src/domain/csv-editor/csv-dirty.ts`：保存快照消费的表格行脏标记。
- `src/domain/csv-editor/csv-table-draft.ts`：提交后的表格基线、行序、行键映射及 dirty 接纳。
- `src/domain/edit-session.ts`：历史双栈原语与正式保存后保留后续草稿的接纳规则。
- `src/domain/editors/weapon-spec.ts`：武器关联创建消费的统一分支推断。
- `src/domain/entity-write/spec-construction.ts`：武器分支定义与正式规格构造。
- `src/domain/schema/csv-schema-registry.ts`：表格消费的列 schema 加载入口。
- `src/domain/schema/csv-value-validation.ts`：列 schema 所属的数字、整数、布尔、固定选项及必填值检查。
- `src/domain/schema/schema-source-definitions.ts`：表格字段候选的来源解析与配置刷新路径。
- `src/orchestrators/json-write-confirmation.orchestrator.ts`：保存提交所属的逐源重排确认。
- `src/orchestrators/project-sync.orchestrator.ts`：表格保存消费的 receipt 同步与反馈入口。
- `src/services/source-catalog.service.ts`：表格字段候选读取及失效判断。
- `src/shared/lib/starsector/rows.ts`：表格行显示标识与关联规格标识。
- `src/shared/lib/starsector/tables.ts`：游戏表格名称。
- `src/shared/runtime/app-log-queue.ts`：行实际挂载、输入提交及驻留生命周期的详细记录。
- `src/shared/runtime/editor-problems.ts`：文档问题聚合、原文错误优先、保存失败及问题区展示请求。
- `src/shared/runtime/use-layout-frame.ts`：网格视口与输入锚点更新的帧合并及作用域释放。
- `src/shared/types/csv-table-history.types.ts`：CSV 草稿操作及历史条目协议。
- `src/shared/types/table-save.types.ts`：CSV 保存请求、行修改、关联规格动作及正式写入目标契约。
- `src/shared/types/tables.types.ts`：CSV 行、单元格目标、窗口与预览契约。
- `src/shared/types/write-commit.types.ts`：公共保存回执、提交同步、行键映射与正式内容交付。
- `src/shared/ui/EditorProblems.vue`：完整红黄问题列表、计数与共同展示。
- `src/stores/project.store.ts`：指定 Mod 的正式清单与 session 查询，异步动作消费捕获目标。
- `src/test/fixtures/csv-row.ts`：CSV 草稿行的测试构造。
- `src/test/unit/csv-input-host.ts`：CSV 输入提交的组件测试宿主。
- `src/windows/current.window.ts`：保存来源消费的当前原生窗口身份。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。
- `src/app/composables/use-app-lifecycle-assembly.ts`：所属窗口的响应式编辑历史容量绑定。
- `src/orchestrators/workspace-history.orchestrator.ts`：当前表格输入提交与表格历史分派。
- `src/orchestrators/workspace-lifecycle.orchestrator.ts`：所属 Mod 的草稿历史释放。

### 关联

- `src-tauri/src/services/write_transactions.rs`：根写入租约、版本复核、历史登记、回放及会话内容接纳。
- `src/shared/lib/starsector/index.ts`：游戏值、颜色与表格规则的转导出入口。
- `src/shared/lib/starsector/value.ts`：JSON 复制、标量转换与 Mod 版本展示。
- `src/shared/types/json.types.ts`：JSON 业务值与输入形状契约。

## 边界

- 工作区宿主交付完整表格目标、清单、有效游戏根、持久列宽和定位动作；CSV model 派生所属内存状态，ViewModel 维护窗口接纳、搜索和过滤。
- 保存归表格编排，草稿撤销重做归所属表运行态，身份交接锁由所属运行态提供。
- 列语义来自 schema 加载器，持久化列宽归 workspace 的 Mod、表、列上下文。
- 双栈结构消费编辑会话原语，CSV 操作反演、行数和行序维护归表格领域。
- 表格保存及正式行接纳消费编辑会话的后续草稿保留规则，接纳步骤使用公共任务契约。
- 后端返回窗口行、来源位置与 `rowKey`，CSV store 持有行草稿、选择、dirty 和保存状态。
- 图片列在增强模式使用列声明的目录候选及选择浮层，纯文本模式使用原文输入；选中图片经单元格提交与历史边界交付。
- 控件拥有原文，表输入集合拥有登记与提交，单元格动作以完整 `CsvCellTarget` 交付草稿历史。
- 文件历史维护已写盘 changeset，表格历史维护内存中的 CSV operation。
- 网格拥有可视窗口、列宽交互、矩形选区与活动列，活动格由活动列及表运行态的响应式 `selectedRowKey` 共同派生；区域操作通过所属表输入上下文读取行及提交批量草稿。
- 行业务 data、`isComment` 和 `rowKey` 分别表达，来源位置与当前显示位置分别投影。
- 表格运行态与输入集合由 `initializeModTables` 按 session、Mod 和 manifest 建立。

## 链路

### 打开表格窗口

1. 表格进入时按需请求当前表的首批行，并在可视区及提前量范围内继续读取。
2. ViewModel 按完整目标接纳列宽并处理所属草稿保护。
3. CSV 读取能力装配 query identity 与 command，后端返回窗口与源索引。
4. store 按捕获目标写入行、表头与总数，网格按可视区调度并保留已挂载行。
5. 缺失的 14 类 CSV 依次采用 Core 表头与对应 schema 列，已有文件使用自身表头；缺表首次保存支持只有表头的空文件。

### 编辑单元格

1. 单击文字、标签或缩略图时，所属输入集合提交前一个编辑动作，网格接纳选中列并交付所属行选择。
2. 已选中的单格再次单击或双击时进入原文编辑并按点击位置定位，F2 在原文末尾开始编辑，直接文字输入替换原值；Smart 模式的引用、枚举、布尔、标签、多选及图片路径在下拉栏顶部编辑完整原文，独立箭头打开空搜索框与完整候选，再次点击提交并收起。
3. tables 记录完整活动身份，控件登记原始输入；缺失列 schema 时使用文本编辑。
4. 提交经目标化单元格变更边界写入行值并登记一次历史。
5. 已提交行差异进入行脏标记，活动输入差异进入表与 Mod 未保存判定。
6. 选中格的方向键按当前显示行列顺序移动，原文编辑中的方向键移动文字光标；Enter 与 Tab 提交后分别向下及向右选中，Shift 反向，长文本 Alt+Enter 换行，Esc 取消编辑并保留选中格。
7. Tab 在行边缘转至相邻行首列或末列，整表首尾及上下边缘保留边界格，导航沿所属窗口读取、挂载与滚动流程显示目标。
8. 候选搜索 Enter 确认单选或添加多选值，确认收起后保留选中格；Tab 提交已选值并导航，搜索原文保留在所属列表内；顶部原文编辑采用文本提交与导航规则，多值候选勾选同步完整原文，数字模板追加后选中模板文字。
9. 下拉栏顶部的上下键按展开分组与筛选后的顺序移动候选高亮并滚动显示，Enter 采用候选点击动作；继续输入清除高亮并恢复文字提交，组合输入期间按输入法处理。

### 选区与批量编辑

1. 左键拖动、Shift+单击或方向键扩展矩形选区，视口边缘自动滚动；Ctrl+A 选中当前显示的全部行与业务列，单击建立单格选择。
2. Ctrl+C 按显示顺序复制文件原值，Ctrl+V 从选区左上角按剪贴板实际行列数写入并选中写入范围；制表符、引号与格内换行按文字剪贴板格式交换。
3. 超出末列时反馈所需及剩余列数；超出表尾时追加空白行，搜索结果中的新行放在文件与当前结果末尾，下次搜索重新匹配。
4. Delete 清空选区，Ctrl+Enter 将当前输入原样填入选区；Ctrl+D 取选区首行向下填充，Ctrl+R 取首列向右填充，单格操作分别取上方或左侧格子。
5. Enter 按列、Tab 按行在多格选区内循环，Shift 反向；活动格使用主色边框，区域格使用主题选中色，右键提供复制、粘贴、清空与方向填充入口。
6. 区域动作捕获所属目标和选区，提交活动输入后共享窗口的分批读取，完整内容就绪后一次提交；表格、搜索、基线、保存及选区交接结束较早动作的接纳权。
7. 批量历史组合单格修改与新增行，撤销逆序回放，重做正序回放，正式行键映射同步批量成员与选区端点。

### 联队引用跳转

1. 联队详情按当前行交付船体与装配跳转动作。
2. 动作等待保存及同步、提交活动输入，并通过联合编排解析实际引用和来源。
3. Mod 舰船记录交付正式行键，皮肤与装配交付实际实体身份，由工作区与目标页面共同完成选择和滚动。
4. 原版引用交付来源提示，缺失与失效结果交付所属反馈。

### 选择行

1. 点击行头选择整行，Shift 从固定起点连选，Ctrl 加入或取消分散行；选择模块按显示顺序交付行键集合，store 的 `selectedRowKey` 表示活动行。
2. 复制所选行及 Ctrl+C 将全部字段写入剪贴板，Ctrl+V 沿用按格覆盖；Delete 清空字段，Ctrl+-、工具栏及行菜单删除所选记录，单次删除登记一条批量历史。
3. 行菜单的插入复制行读取剪贴板内容，在命中行前分配独立行身份并连续插入，后续行下移，整次插入对应一条历史。

### 新建与拖动行

1. 新建行插在当前选中行下方并成为选中行，无选中行时追加至表尾。
2. 行手柄在短点击时处理选择，在拖动开始时固定整组行键；普通拖动将所选行按原表顺序插入落点，最终行序相同时按无变化处理。
3. Ctrl+左键拖动在按下鼠标时固定复制模式，副本保留全部业务字段与注释标记、分配独立行身份并成为所选行；搜索期间的复制落点按实际文件行身份解析，副本同时进入当前搜索结果。

### 过滤与搜索

1. 搜索框提供清空及 ID/名称、ID、名称、tags 搜索项菜单，当前项显示勾选，切换搜索项时保留关键词。
2. ViewModel 提交所属输入并复核目标，查询正式匹配结果并合入发起时捕获的本地行草稿，按草稿顺序交付本次结果；关键词去除首尾空白并忽略大小写进行包含匹配，空关键词返回全部草稿行。
3. 查询接纳消费草稿与活动输入保护状态；当前匹配集合随所属文档保留，单元格修改与保存回执更新内容，显式搜索更新匹配集合。
4. 全部行被过滤或无可显示列时显示对应说明。
5. 同 Mod 切表恢复 id-name 并清空关键词，返回同一当前表时保留搜索上下文，切表时释放旧搜索菜单。

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

1. 用户触发页头或 Ctrl+S，捕获所属表、session 和实际修改。
2. 捕获内容经所属项目队列顺序执行，其他对象的草稿独立保留。
3. 所属输入集合逐项提交原始输入，编排复核目标、session 与 tables 状态。
4. 编排捕获独立 patches、版本凭据、关联候选与历史身份集合。

### 提交保存

1. 目标为空或已有表无 dirty 时返回 noop；缺表首次保存消费已有准备表头；同文档的排队及进行中保存由同一请求表达。
2. 分表校验消费全表精简基线与当前草稿，错误交付保存拒绝和问题区展开请求，警告逐次确认；确认内容变化时重新捕获并检查。
3. 关联文件批量准备读取原文件、目标、问题与匹配版本，app 层在同一确认窗口逐项选择读取、覆盖或仅保存 CSV，有效已有目标默认读取；模板创建的武器提供 projectile 与 beam 调整。
4. 编排复核目标并消费同一快照中的 patches、关联动作与版本。
5. 调用排他写提交 patches 与关联动作。
6. 后端复核确认目标与文件版本，读取保留目标原文，覆盖优先采用有效原文件并更新 ID、缺少时消费默认模板；改名移除本地旧文件，CSV 与文件共同进入原子 changeset。
7. 返回写结果、`rowKey` map 与结构化失效。

### 保存后接纳

1. session 已变化时保留 dirty 并返回 saved，不做本地提交。
2. 将提交 patches 和返回版本共同接纳到 original 基线。
3. 将当前行、编辑目标与草稿历史映射到保存后的 `rowKey`，按该基线重算 dirty。
4. 保存事件顺序完成历史、清单、缓存、所属行基线和必要内容交接。
5. 所属保存回执完成同步后反馈一次成功；同步失败保留该回执及已接纳基线，重试继续同步。

## 规范

- 分表检查必须登记所需列与纯校验函数，共同消费全表精简基线、当前草稿及稳定行身份；顶部提示与保存门控消费同一问题结果。
- 类型错误、必读列缺失与确定失效的必需引用必须阻断保存，字段关系、有效 hints 组合及脚本来源不确定交付黄色提醒；USE_VS_FRIGATES 允许独立使用。
- 图片及脚本检查必须使用授权的当前 Mod、引用与 Core 根，脚本 JAR 每次读取建立一次类条目索引并供同批类名复用；校验严禁执行用户脚本。
- 缺失舰船或技能规格的身份创建必须沿关联规格选择交付，只有 CSV 的提交拒绝缺少所需规格的记录。
- 校验必须覆盖当前 Mod 同一整表的非注释业务记录；实体表检查有值 ID 的唯一性，描述检查 ID 与类型组合唯一性，模拟对手按允许重复的列表处理，联队有值 ID 交付小写 _wing 后缀提醒。
- 行校验、重复身份检查与校验来源查询必须统一按非注释行的身份字段非空判定业务记录；模拟对手必须使用 `variant id`，其余表必须使用 `id`；空身份说明行必须原样保存。
- 单元格选择与编辑必须分别维护，组合输入完整保留首字及组字过程，保存行键映射保留选中列及所属行身份。
- 区域动作必须等待所需行完整读取后一次提交，单次动作只允许登记一条包含前后值与新增行的历史；搜索隐藏行保留原内容，批量成员消费保存后的行键映射。
- CSV patch 必须携带读取基线与 `isComment`，恢复行携带 `insertAt`；正式 `rowKey` 删除命中实际行，未知键返回冲突。
- CSV 新增行的 `insertAt` 必须将省略与 `null` 共同解释为末尾插入；显式位置沿现有插入规则处理。
- CSV 最终行序必须在同一保存快照中捕获，源位置与新增行键在版本校验后解析；顺序完整、唯一且覆盖保存后的全部记录，内容与行序进入同一次文件历史。
- limit 必须由窗口装配按当前 `editHistoryLimit` 同步输入；初始化、设置变化及镜像立即裁剪全部现有表的最早 undo 并保留 redo，新建与重建文档消费当前容量，卸载结束观察。
- native 文本、多行浮层与多选必须在一次编辑动作结束时产生一条前后值操作；原始输入期间只允许登记待提交状态。
- 保存映射必须同步 operation.rowKey 与行记录身份；来源位置与恢复插入位置分别交接。
- 关联 spec 改名必须按本次 `preserveOriginalJson` 设置更新旧文件文本；需要整体重排时在 CSV 与 spec changeset 应用前确认。
- 再次保存必须提交当前输入并捕获新快照，文件动作消费所属项目执行顺序，内容读取失败由维护者独立处理。
- 列宽覆盖与测量锁定必须绑定 session、Mod 与表；目标变化先接纳所属列宽再处理 dirty 与读取。
- 列宽调整必须直接更新 workspace 所属覆盖值，展示派生消费同一覆盖值。
- 删除 patch 必须携带删除动作标记，严禁以空 upsert 表达删除。
- 前端新增行只允许使用临时 new key，保存后以后端 `rowKey` map 替换。
- 单元格编辑必须在动作提交边界一次性写值与登记历史；中间输入参与未保存判定，行脏标记只允许表达已提交行差异。
- 历史栈严禁持久化，仅在内存按会话存在。
- 已有来源的保存、删除与改名必须消费实际已加载路径；改名保留原目录，来源缺失消费所属默认创建构造。
- 当前展示目标必须消费工作区的当前项目投影，异步动作捕获并持续消费所属 Mod 根与 session。
- 拖动必须归网格实例，指针取消、Escape、目标变化、基线交接及卸载释放所属捕获、插入目标与帧循环。
- 操作必须携带足以反演的前后值，严禁保存整表快照。
- 搜索必须将正式匹配结果与发起时捕获的本地新增、修改及删除共同投影，并按草稿行序展示；关键词或搜索字段显式变化时才允许重新匹配，单元格编辑、保存接纳和页面返回保留当前匹配集合。
- 查询窗口必须提供实际 `sourceRowIndex`；网格 rowIndex 只允许表达当前显示位置。
- 横向可视列必须保留原始列位置并提前准备左右各一列，活动编辑列及其输入锚点持续驻留。
- 武器 CSV 关联改名必须共同提交实际规格与所属 `WEAPON` 描述 ID；描述目标占用拒绝全部关联 changeset。
- 缺失列 schema 的列只做文本编辑，严禁猜测控件类型。
- 联合字段补列必须消费 Core 权威表头或正式列资产；全部标准列按来源排序，自定义列保留内容与相对顺序。
- 舰船关联改名必须依据原规格的 `descriptionId` 声明决定默认描述行交接；默认描述 ID 更新共同进入 CSV 与规格事务、历史及结构化失效。
- 行序差异必须参与表格与 Mod 未保存判定，恢复已接纳顺序清除对应行序差异；创建、删除、移动及回放共同维护顺序序列与选中身份。
- 行移动必须捕获稳定行键与移动前后位置，普通行、注释行及空白记录各自独立移动；原位放下按无变化处理。
- 表格完整行必须按可视区及上下各一个视口的提前量请求，整表校验只允许取得分表登记列的精简数据。
- 表格缩略图必须由网格管理可见与邻近资源集合；行组件首次进入提前量时挂载，单批最多挂载四行并在组件更新后复核 4ms 调度预算；已访问行在当前表内持续驻留，切表、目标替换或卸载时释放所属展示引用与输入登记。
- 表格身份释放事件必须按原请求的 session 和 Mod 核对当前会话；回执只允许更新所属行与基线，会话重开后仅释放原锁。
- 表运行态只允许接纳所属 CSV 的基线版本；规格版本必须归关联保存快照与实体记录。
- 表锁必须覆盖提交与本地 receipt 接纳；锁定期间保持读取接纳与编辑动作归属，失败、窗口销毁和会话结束释放锁。
- 规格保存必须共同提交所属 CSV 修改，其他对象的草稿、原文与草稿历史由所属会话独立保留。
- 顺序草稿必须通过基线源位置与新增行键表达，窗口读取映射实际源区间并按当前顺序接纳；同基线的新窗口保留已编辑行，外部基线进入更新保护。
- 磁盘刷新与其它窗口的结果必须经过外部基线保护，原始输入、行序和历史共同保留；当前窗口保存接纳实际写盘基线，事件读取消费所属读取票据。
- 首列变化必须按正式注释身份装配标记；文字值以 # 开头的业务行保留字面内容和必要引号。
