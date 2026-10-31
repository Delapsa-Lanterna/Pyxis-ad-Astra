# JSON 文档编辑

## 定义

JSON 文档编辑模块提供 Mod 信息、势力、战役、装配、舰船皮肤与杂项配置的表单、草稿、历史、身份交接和保存。

## 参考

### 拥有

- `src-tauri/src/commands/json_file.rs`：装配与皮肤的保存、创建、删除及会话来源核对。
- `src-tauri/src/commands/json_recovery.rs`：来源重建准备、事务版本复核与 changeset 提交。
- `src-tauri/src/domain/json_documents.rs`：Variant 与 Skin 的正式内容构造及计数投影。
- `src-tauri/src/services/config_entity.rs`：Mod 信息保存、战役索引及任务目录的保存、创建和删除。
- `src-tauri/src/services/json_file.rs`：装配与皮肤文件查询、保存、创建、删除和重命名。
- `src-tauri/src/services/project/query/json_recovery.rs`：按已读取原目标重新授权来源、索引及版本。
- `src-tauri/src/services/project/write/faction_identity.rs`：势力索引、实际规格目标及保存删除。
- `src-tauri/src/services/project/write/json_recovery.rs`：缺失基线渲染、必要索引修复和实际 changeset。
- `src/app/components/json-editor/`：六类 JSON 编辑页面、列表、表单与主窗口生命周期验证。
- `src/app/composables/json-editor/`：页面身份、目标会话、列表选择、输入、资源和保存装配。
- `src/domain/json-editor/`：独立文件与索引配置的内容规则、默认值、记录投影和装配模块转换。
- `src/orchestrators/json-save.orchestrator.ts`：配置保存编排、文档来源恢复与回执接纳。
- `src/services/json-entity.service.ts`：Mod 信息、势力与战役写入、身份准备和草稿资源查询。
- `src/services/json-file.service.ts`：装配与皮肤的保存、创建和删除能力包装。
- `src/services/json-recovery.service.ts`：重建准备与正式提交的 IPC 包装。
- `src/services/json-resource.service.ts`：配置资源 service。
- `src/stores/json-editor.store.ts`：文档登记、每 session 类型选择记忆及当前文档动作。

### 消费

- `src-tauri/src/domain/entity_definitions.rs`：八种实体的目录、后缀、ID 字段及规格、表格关联登记。
- `src-tauri/src/domain/entity_identity.rs`：实体 ID、路径及来源边界纯规则。
- `src-tauri/src/domain/schema.rs`：保存时消费的字段内容与结构校验。
- `src-tauri/src/io/faction_index.rs`：势力索引引用的所属根授权。
- `src-tauri/src/models/config_entity.rs`：Mod 信息与索引实体请求、刷新内容及势力索引结构。
- `src-tauri/src/models/json_file.rs`：JSON 文件写入与删除请求协议。
- `src-tauri/src/models/json_recovery.rs`：来源重建请求、计划和版本协议。
- `src/app/components/schema/SchemaFormRenderer.vue`：schema 字段表单展示。
- `src/app/composables/use-edit-target-draft-session.ts`：目标快照、草稿、保存与外部版本交接。
- `src/app/composables/use-field-input-actions.ts`：字段输入提交、取消与外部版本确认。
- `src/app/composables/use-query-read-owner.ts`：所属读取票据与读取生命周期。
- `src/app/composables/use-snapshot-history.ts`：按 EditContext 绑定的前后值撤销历史。
- `src/domain/project/entity-definitions.ts`：实体内容 ID、通用 ID 规则与重命名身份投影。
- `src/domain/project/entity-versions.ts`：目标版本凭据与改名目标凭据交接。
- `src/domain/schema/config-schema-registry.ts`：装配与皮肤 schema。
- `src/orchestrators/immersive-editor.orchestrator.ts`：装配沉浸式编辑器打开动作。
- `src/orchestrators/json-write-confirmation.orchestrator.ts`：原文保留、规范化写入确认与重试。
- `src/orchestrators/main-history-command.orchestrator.ts`：主窗口活动 JSON 草稿撤销与重做分派。
- `src/orchestrators/project-sync.orchestrator.ts`：提交 receipt 接纳、来源刷新及跨窗口通知。
- `src/services/entity-query.service.ts`：实体列表、详情、正式目标和身份意图查询。
- `src/services/hull-reference.service.ts`：船体名称、Hull 引用和内置武器槽查询。
- `src/services/query-cache.service.ts`：实体与引用查询失效订阅。
- `src/shared/runtime/document-editor.ts`：活动文档的输入、保存与历史动作契约。
- `src/shared/types/config-entity.types.ts`：Mod 信息与索引实体保存请求、刷新内容及编辑投影契约。
- `src/shared/types/json-file.types.ts`：JSON 文件命令协议和编辑文件投影。
- `src/shared/types/json-recovery.types.ts`：前后端对应的来源重建协议。
- `src/shared/types/project-identity.types.ts`：实体目标与版本凭据协议。
- `src/shared/types/write-commit.types.ts`：公共保存回执、提交同步、行键映射与正式内容交付。
- `src/stores/draft-sessions.store.ts`：按 Mod 根登记未保存草稿。
- `src/stores/project.store.ts`：指定 Mod 的正式清单与 session 查询，异步动作消费捕获目标。
- `src/stores/save-command.store.ts`：保存等待、活动保存动作和目标交接状态。
- `src/stores/settings.store.ts`：JSON 写入方式与编辑历史容量设置。
- `src/stores/workspace.store.ts`：当前 Mod、session 与 JSON 页面投影。

### 装配

- `src-tauri/src/services/mod.rs`：后端正式业务函数入口。
- `src/app/AppContent.vue`：主窗口持续挂载 JSON 页面宿主。

### 关联

- `src-tauri/src/services/project/write/entity_identity.rs`：装配改名涉及父装配引用、CSV 和联合保存范围。

## 边界

- JSON 保存编排拥有 Mod 信息、势力、战役、装配与皮肤的写动作和 receipt 交接。
- JSON 文档会话拥有 base、draft、dirty、活动输入、外部基线和对象快照历史。
- JSON 页面宿主展示当前文档，独立 effectScope 与模块登记表持有全部已访问文档直至 session 关闭。
- 共同列表与文档宿主装配 JSON 页面，类型定义与能力提供 schema、内容转换、排序、媒体及关联文件规则。
- 文档类型定义提供所属逻辑文档的身份字段并消费正式实体 ID 规则，独立文件定义提供装配与皮肤的标题、排序及引用差异。
- 索引配置适配拥有势力索引、战役目录和 Mod 信息内容，索引与目标文件共同进入所属事务。
- 编辑 store 持有文档登记表与当前动作；每份文档运行态拥有基线、草稿、快照历史、恢复与保存登记。

## 链路

### 页面与草稿

1. 主窗口持续持有 JSON 页面宿主，宿主挂载当前 session 与类型的共同页面。
2. 页面读取正式记录，列表绑定所属文档运行态的摘要；已访问文档由独立 effectScope 与模块登记表保留。
3. 表单字段提交进入 JSON 文档会话并登记对象快照历史。
4. 导航等待全部保存及同步并提交活动输入；离开页面释放视图、读取及媒体。
5. 返回页面恢复选择与文档运行态，滚动回顶部并采用 schema 默认展开；外部差异进入所属待载入版本。
6. session 释放销毁全部所属页面、草稿、保存登记和历史。

### 保存与身份交接

1. 保存入队捕获文档与 session，轮到时提交所属输入、读取最新草稿和版本并捕获独立提交快照。
2. JSON 保存编排准备身份与版本，消费 JSON 写入确认和对应业务服务。
3. Rust command 在统一事务中复核目标、版本及索引，并提交实际变更集。
4. 文档会话接纳实际基线，保存期间的新输入与草稿保留。
5. receipt 交给项目同步更新文件历史、清单、缓存与窗口。

### 撤销与重做

1. 主窗口历史命令提交活动 JSON 输入并复核当前身份。
2. 对应快照栈存在条目时更新草稿，空栈交给当前 Mod 的文件历史。
3. 输入拒绝或身份失效结束当前历史动作。

### 来源重建

1. 文档运行态核对原目标来源及必要索引，接纳缺失清单、现存内容和版本凭据。
2. 用户确认具体恢复路径和标准排版，正式目标交接准备所属物理范围。
3. command 在 FIFO 事务内复核计划，write 采用最后保存基线重建缺失文件及必要索引。
4. 文档先接纳已恢复版本并保留草稿，再暂存现存文件的外部差异。
5. 回执经项目同步完成后反馈；同步失败保留回执并由原保存句柄重试。

## 规范

- Faction 与 Mission 的打开入口必须命中对应后端实体定义的目录与扩展名。
- Faction 与 Mission 索引必须消费 `CsvRow` 的 data 和 `isComment`；保存回执的 `indexRows` 必须保留两者，实体选择只允许消费非注释的正式 ID 行。
- Faction 的本地改名必须由编辑会话先接纳目标与实际基线，再共同更新列表及选择，保存期间的新输入必须保持原控件与所属会话。
- JSON 保存与删除必须经正式 Rust command、统一事务和 WriteResult；组件与 store 严禁直接调用 IPC。
- JSON 保存成功反馈必须在写盘及同步完成后发出一次；待同步回执必须由文档生命周期持有并仅重试同步。
- JSON 文档切换和页面重新激活必须恢复顶部及 schema 默认展开；正式身份交接必须保留活动控件和输入原文。
- JSON 文档必须按 session、Mod 根、种类及正式目标绑定身份；全部已访问文档必须保留草稿、基线和快照历史至 session 关闭。
- JSON 本地保存必须保留文档快照历史；保存后撤销必须更新内存草稿并按实际写盘基线重算 dirty。
- JSON 草稿历史必须消费 settings 的 editHistoryLimit，目标加载、外部基线与 reset 必须遵守 EditContext 清理行为。
- JSON 页头撤销重做必须消费当前草稿历史；待提交输入必须先提交，非法输入必须保留原字段与历史。
- JSON 页面离开必须释放列表、详情与媒体读取并撤销迟到结果接纳权；保存参与者必须保留所属目标及草稿。
- Mission 与 Faction 的写入职责必须分别归任务目录 owner 与势力身份 owner；修改 ID 必须按所属格式执行完整改名。
- Mission 列表必须消费索引顺序并按索引记录展示名称，所选项必须完成所属详情读取后建立文档；Faction 必须消费 ID 排序。
- Mission 的本地改名必须由实际保存记录共同交接草稿基线、列表与选择；保存回调必须保留所属版本。
- Variant 与 Skin 的目录、扩展名、内容 ID 和改名目标必须由后端实体定义及正式 query 结果确定。
- Variant 改名涉及的主文件、父装配引用、版本校验与 receipt 必须共同进入同一根事务。
- `mod_info` 必须使用目标 Draft Session。
- 业务 JSON 的顶层键、嵌套字典键与数组对象键必须完整保留；运行时身份、版本与资源投影必须由实体记录承载。
- 主窗口历史必须先提交活动 JSON 输入再判定撤销栈；输入拒绝或目标变化必须结束本次命令。
- 保存 Mod 信息、势力、装配与皮肤必须校验已提供对象的所属字段结构；新增依赖与武器组必须交付有效初值并拒绝缺失的必填内容。
- 保存入口必须在点击时捕获所属输入与独立修改，所属队列必须将捕获修改应用到当前正式内容；请求期间的新编辑必须保留，base 必须更新为实际写盘内容，dirty 必须按该 base 与当前 draft 比较。
- 保存必须先提交所属活动输入与动作；实际内容必须在后续同步前接纳为基线，同步失败必须保留该基线并结束等待交接。
- 列表动作准备必须捕获所属 Mod 和 session；等待保存后的同步必须消费捕获根，错误呈现必须核对所属会话及视图生命周期。
- 列表名称与 ID 必须消费已提交草稿并显示未保存状态；列表与文档必须按身份索引关联并复用未变化摘要，正式身份及排序必须消费所属领域规则。
- 列表筛选必须提交所属输入并复核页面身份，按 ID、显示名称或两者忽略大小写包含匹配，杂项配置必须按文件名匹配 ID；筛选必须保留当前文档，搜索状态必须按 session 隔离，同页返回必须保留，切换页面种类必须重置，session 释放必须清理。
- 列表筛选输入框必须共同提供清空与搜索项箭头菜单，当前搜索项必须显示勾选。
- 列表图片必须在上下各一个容器高度的预读区内按需解析，资源失效后可见图片必须重新解析。
- 列表查询结果只允许在捕获身份与请求代次仍有效时接入；卸载必须释放在途结果，失败必须经 `AppFeedback` 呈现，重试必须使用当前 session。
- 创建与删除的列表刷新必须由动作 owner 执行一次；写入期间所属失效必须合并到动作接纳。
- 创建与改名必须在 FIFO 事务中复核源版本、关联索引及目标不存在凭据；源与下一目标必须分别表达。
- 初载与删除当前项后必须选择所属展示排序的首项；空列表必须采用空选择；删除其他项必须保留当前选择。
- 势力 logo/crest 与战役 icon 必须按当前草稿引用独立查询资源；列表必须消费对应 crest 与 icon 缩略图；接纳必须核对目标、资源字段、请求顺序与生命周期。
- 势力创建必须由正式构造器提供 logo、displayNameWithArticle、names、portraits 和 RGBA color，并使用游戏 UI 颜色字段。
- 势力加载身份必须消费规格内容的字符串 id；索引必须提供实际文件目标，读取、版本、保存与删除必须消费同一授权路径。
- 势力索引修改必须保留表头、行位置与业务列，只允许更新所属 ID 和引用字段。
- 原版编辑权限必须消费持久化 `AppSettings.allowCoreEditing` 和完整设置镜像，缺省必须为关闭。
- 同 session 刷新必须共同接纳内容和版本凭据；dirty 草稿必须共同暂存外部内容与凭据，载入外部版本必须共同交接。
- 后台改名必须由所属文档接收；干净文档必须接纳正式身份；有草稿的文档必须记录待交接状态并在激活时确认保留编辑并跟随。
- 外部删除当前 dirty 目标时必须保留编辑面并呈现删除提示；确认放弃后必须交接到所属首项。
- 外部实体定位必须经所属列表选择流程接纳实际 ID，并在读取完成后定位选中条目；皮肤沉浸式入口必须交付 skin 身份和正式联合打开流程。
- 外部更新在草稿 dirty 时必须暂存正式内容与版本，载入前必须提交输入并确认目标仍有效。
- 外部版本载入与实体选择必须等待已登记保存及同步，输入提交失败必须保留字段、焦点和目标；明确放弃必须确认所属目标。
- 字段输入提交必须先于保存、目标交接与主窗口草稿撤销重做；一次文字提交必须登记为一次草稿历史，未提交原文必须参与 dirty 与关闭判定。
- 实体 View 必须持续持有列表与文档区域，Editor 必须承载所属目标内容并只读交付 handoffLocked。
- 实体列表与编辑记录必须共享正式 ID、目标、内容、路径与 baseVersions。
- 已访问文档的全部或部分来源缺失时必须保留列表项、缺失标记与重新创建入口；明确删除必须合并来源、索引和放弃草稿的一次确认并释放缓存。
- 当前展示目标必须消费工作区的当前项目投影，异步动作必须捕获并持续消费所属 Mod 根与 session。
- 当前编辑目标的放弃必须统一确认，空列表与存在后继记录必须消费同一交接流程。
- 所有 JSON 字段必须通过所属 Draft Session setter 更新；dirty 必须由 base 与 draft 比较。
- 改变目标的配置动作必须短暂锁定当前编辑面；按钮与保存快捷键必须共同消费锁定，结束后必须释放。
- 整体内容的 inert 必须由 View 合成动作锁与编辑器交接锁，所属会话与 Mod 身份必须决定编辑器生命周期。
- 文档、列表及来源候选必须按所属职责消费所属保存及来源刷新结果；文档回执必须共同核对正式归属、内容与版本，恢复结果必须保留资源和缺失来源信息。
- 文档缓存身份必须包含 session、Mod 根、种类及实际正式目标；选择记忆必须按 session 与文档种类隔离。
- 杂项配置必须按登记顺序保持全部文件条目及 session 选择，缺文件必须在右侧创建；正式文档必须消费所属文件投影、schema、内容与版本。
- 来源恢复必须共同交付同一字节快照的内容、版本及所属资源引用，索引关联必须复用本次解析结果；返回页面、来源失效及重建接纳必须直接消费恢复结果中的内容、版本、资源与缺失清单。
- 来源重建必须保留草稿中的内容与 ID；现存关联文件必须保留磁盘内容，外部差异必须进入现有版本确认。
- 来源重建必须覆盖 Mod 信息、Variant、Skin、Faction 文件及必要索引、Mission descriptor、正文及必要索引行与已登记杂项配置文件。
- 来源重建必须重新授权原目标并核对准备与事务内版本，缺失来源必须采用最后保存基线、原路径和原身份。
- 普通保存遇到已读取来源缺失时必须确认实际缺失路径，并使用本次捕获内容完成重建及保存。
- 界面刷新必须由所属根登记实际来源与动作，并沿现有保存等待、草稿和外部更新接纳流程执行。
- 皮肤引擎槽修改必须按基础船体及继承皮肤的移除顺序校验整数索引，越界修改必须在写盘前拒绝。
- 结构化 JSON 保存必须使用设置快照选择原样更新或规范化写入；原样更新无法安全完成时必须在写入前确认影响文件。
- 编辑目标必须由后端 query 交付；保存必须消费捕获的目标、正式路径与版本凭据。
- 表单双向绑定必须经统一 Draft Session setter 提交；保存动作必须返回已保存、无需保存或已取消；已保存结果必须携带正式回执；校验拒绝与保存取消时严禁提交成功基线或触发保存成功回调。
- 装配武器组新增必须由明确槽位选择触发；主动选择其它组已有槽位必须携带原武器调组，并在一次草稿历史中交付。
- 配置保存的传输内容必须消费 `IndexedConfigEntityRefresh`；编辑数据必须由所属投影共同接纳回执版本。
- 配置列表必须以 `sessionId` 与 `modRoot` 共同归属数据、版本凭据、资源引用和选择；身份切换必须同步清空这些状态，新列表到达后才允许建立编辑目标。
- 配置编辑会话必须登记实际版本覆盖的文件范围及所属保存动作；联合交接必须保留配置身份和动作 owner。
- 配置编辑器生命周期必须按 session 与 Mod 隔离；同名实体切换必须加载目标基线，保存回调严禁读取其他 Mod 的活动目标。
- 配置读取必须消费实体查询能力的只读记录；列表记录和编辑模型必须由领域 mapper 生成独立内容、目标和版本快照。
- 重命名必须同时更新索引行、实体文件与文件名，并保持 history 可回放。
- 页面离开必须撤销读取票据与媒体接纳权，并退出全局活动 JSON 编辑目标。
