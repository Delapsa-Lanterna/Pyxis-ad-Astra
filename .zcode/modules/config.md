# 配置系统

## 定义

配置系统提供 Mod 信息、势力和战役编辑，以及配置实体的列表与目标交接。

## 参考

### 拥有

- `src-tauri/src/commands/config_entity.rs`：Mod 信息、势力与战役保存、创建和删除 command。
- `src-tauri/src/domain/config.rs`：配置 ID、实体路径及装配、皮肤文件构造。
- `src-tauri/src/services/config_entity.rs`：Mod 信息保存、战役索引及任务目录的保存、创建和删除。
- `src-tauri/src/services/project/write/faction_identity.rs`：势力索引、实际规格目标及保存删除。
- `src/app/components/config/ConfigFactionEditor.vue`：势力目标字段与保存展示。
- `src/app/components/config/ConfigFactionList.vue`：势力列表选择、创建与删除展示。
- `src/app/components/config/ConfigFactionView.vue`：势力列表与目标编辑组合。
- `src/app/components/config/ConfigMissionEditor.vue`：任务字段、文件与保存展示。
- `src/app/components/config/ConfigMissionList.vue`：任务列表及创建、删除展示。
- `src/app/components/config/ConfigMissionView.vue`：任务列表与目标编辑组合。
- `src/app/components/config/ConfigModInfoEditor.vue`：Mod 信息目标字段与保存展示。
- `src/app/components/config/ConfigModOverview.vue`：Mod 信息、诊断与概览组合。
- `src/app/components/config/ConfigTargetNotice.vue`：目标交接与外部删除提示的展示入口。
- `src/app/components/config/ConfigWorkspace.vue`：配置页组合入口，消费所属实体视图与文件历史展示。
- `src/app/components/config/config-draft-form.spec.ts`：配置草稿与字段表单集成验证。
- `src/app/components/config/config-mission-lifecycle.spec.ts`：任务列表、目标与保存生命周期验证。
- `src/app/components/config/config-session-baselines.spec.ts`：配置 session 与基线隔离验证。
- `src/app/composables/config/config-target-boundaries.spec.ts`：配置目标切换、保存与输入交接验证。
- `src/app/composables/config/use-config-editor-draft-session.ts`：配置目标 Draft Session 组合。
- `src/app/composables/config/use-config-faction-editor-view-model.ts`：势力目标草稿、保存和外部基线接纳。
- `src/app/composables/config/use-config-faction-view-model.ts`：势力列表与新建 ViewModel。
- `src/app/composables/config/use-config-identity-reception.ts`：配置身份读取、确认、记录接纳与释放。
- `src/app/composables/config/use-config-list-selection.ts`：列表选择、草稿确认、动作锁定及提交接纳。
- `src/app/composables/config/use-config-mission-editor-view-model.ts`：任务文档、关联文件、保存与目标生命周期。
- `src/app/composables/config/use-config-mission-view-model.ts`：战役列表与编辑 ViewModel。
- `src/app/composables/config/use-config-mod-info-view-model.ts`：Mod 信息 ViewModel。
- `src/domain/config/config-entities.ts`：配置默认值、ID 与装配 modules 格式及改名纯规则。
- `src/domain/config/config-records.ts`：配置记录与可写快照转换。
- `src/domain/config/mod-overview.ts`：Mod 概览、诊断与目标文件的纯投影。
- `src/orchestrators/config-save.orchestrator.ts`：配置保存编排，拥有十个写动作族。
- `src/services/config-entity.service.ts`：Mod 信息、势力与战役的查询和写入参数装配。
- `src/services/config-resource.service.ts`：配置资源 service。

### 消费

- `src-tauri/src/domain/editor_config_definitions.rs`：八种实体的目录、后缀、ID 字段及规格、表格关联登记。
- `src-tauri/src/io/faction_index.rs`：势力索引引用的所属根授权。
- `src-tauri/src/models/config_entity.rs`：Mod 信息与索引实体请求、刷新内容及势力索引结构。
- `src/domain/project/entity-versions.ts`：保存目标版本捕获与关联表凭据交接。
- `src/orchestrators/json-write-confirmation.orchestrator.ts`：JSON 原文保留、重排确认与写入重试交接。
- `src/shared/types/config-entity.types.ts`：Mod 信息与索引实体保存请求、刷新内容及编辑投影契约。
- `src/shared/types/write-commit.types.ts`：公共保存回执、提交同步、行键映射与 JSON 写入契约。
- `src/stores/project.store.ts`：指定 Mod 的正式清单与 session 查询，异步动作消费捕获目标。
- `src/stores/workspace.store.ts`：当前 Mod 选择、清单与 session 的派生投影。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。

### 关联

- `scripts/architecture/rules/frontend-layer-boundary.mjs`：配置组件的正式依赖边界。
- `scripts/architecture/rules/write-boundary.mjs`：配置写入能力归属的检查。
- `src-tauri/src/services/project/write/entity_identity.rs`：规格、装配与文本身份写入及关联 CSV、父引用暂存。
- `src/shared/lib/row-data.ts`：JSON 对象形状判断及错误交接。

## 边界

- Rust 拥有实体索引、目录、ID、授权目标、changeset 与身份事务。
- domain 提供默认值、内容规则和 schema source，service 交付正式查询与写入模型。
- 保存编排协调实际内容、会话基线与 receipt，写入范围由实体目标及正式身份规则声明。
- 势力、战役与实体族各自提供排序、内容和保存动作，共同消费选择交接入口。
- 原版编辑权限归持久化设置及镜像，原版写入授权由后端目标能力核对。
- 各 ViewModel 拥有列表、选择、资源引用、目标草稿与外部版本暂存，组件呈现表单和动作。
- 新建校验归各 ViewModel，列表交接拥有 dirty 确认、动作锁与正式记录接纳。
- 权威列表与外部删除后保留的当前编辑记录分别投影，草稿和活动输入归所属会话。
- 装配身份事务覆盖当前 Mod 的全部父装配引用，相关文件共同进入版本和保存协调。

## 链路

### Mod 信息编辑

1. 页面经核心 schema 合并后渲染表单。
2. 编辑经显式提交模型写入目标草稿并更新 dirty。
3. 保存经写动作族取得实际持久化内容、版本与提交身份。
4. 编辑会话接纳基线，随后完成文件历史、缓存失效、刷新与列表同步。

### 实体列表与新建

1. 页面加载时查询实体列表与资源引用。
2. 新建对话框校验必填、ID 合法性与冲突。
3. 创建动作经保存编排更新所属索引、实体文件或任务目录并登记历史。
4. 列表交接 owner 等待正式投影接纳，再刷新列表并选中新实体。

### 实体编辑与删除

1. 选中实体加载目标草稿与 schema 表单。
2. 保存经写动作族写入并登记历史。
3. 重命名由后端校验并迁移目标文件。
4. 删除经确认后走删除动作族并清理选择。

### 配置目标交接

1. 选择、新建或删除捕获 session、Mod、实体与交接意图。
2. 共同交接入口等待保存及所属提交同步，并确认最新 dirty。
3. 改变编辑目标的写入锁定所属编辑面，写动作返回正式 receipt。
4. 提交同步完成投影与本窗口接纳，列表 owner 接纳所属列表与选择。
5. 广播失败保留已完成步骤；重试继续通知，投影失败保留 receipt 与当前展示。
6. 动作结束释放锁定，窗口释放结束所属确认和展示接纳。

### 可视区媒体

1. 列表滚动以滚动容器为 observer root。
2. 预读区内实体的图片资源按需批量解析。
3. 媒体 owner 将当前活跃集合交给资源能力，隐藏时释放所属结果。

## 规范

- Faction 与 Mission 索引必须消费 `CsvRow` 的 data 和 `isComment`；保存回执的 `indexRows` 必须保留两者，实体选择只允许消费非注释的正式 ID 行。
- Faction、Variant 与 Skin 的本地改名必须由编辑会话先接纳目标与实际基线，再共同更新列表及选择，保存期间的新输入必须保持原控件与所属会话。
- Mission 与 Faction 的写入职责必须分别归任务目录 owner 与势力身份 owner；修改 ID 必须按所属格式执行完整改名。
- Mission 必须消费索引顺序，Faction 必须消费 ID 排序，Variant 与 Skin 必须消费所属 companion 与 ID 排序。
- Mission 的本地改名必须由实际保存记录共同交接草稿基线、列表与选择；保存回调必须保留所属版本。
- Skin 与 Variant 保存 payload 必须显式提供 nullable relPath；编辑必须使用选中实体路径，创建必须提供 `null`。
- `mod_info` 必须使用目标 Draft Session；Skin 与 Variant 的根文件目标、扩展名与 ID 必须消费后端实体定义。
- 业务 JSON 的顶层键、嵌套字典键与数组对象键必须完整保留；运行时身份、版本与资源投影必须由实体记录承载。
- 保存必须先提交所属活动输入与动作；实际内容必须在后续同步前接纳为基线，同步失败必须保留该基线并结束等待交接。
- 保存必须提交发起保存时的独立快照；请求期间的新编辑必须保留，base 必须更新为实际写盘版本，dirty 必须按该 base 与当前 draft 比较。
- 列表动作准备必须捕获所属 Mod 和 session；等待保存后的同步必须消费捕获根，错误呈现必须核对所属会话及视图生命周期。
- 列表图片必须在上下各一个容器高度的预读区内按需解析，资源失效后可见图片必须重新解析。
- 列表查询结果只允许在捕获身份与请求代次仍有效时接入；卸载必须释放在途结果，失败必须经 `AppFeedback` 呈现，重试必须使用当前 session。
- 创建与删除的列表刷新必须由动作 owner 执行一次；写入期间所属失效必须合并到动作接纳。
- 创建与改名必须在 FIFO 事务中复核源版本、关联索引及目标不存在凭据；源与下一目标必须分别表达。
- 初载与删除当前项后必须选择所属展示排序的首项；空列表必须采用空选择；删除其他项必须保留当前选择。
- 势力 logo/crest 与战役 icon 必须按当前草稿引用独立查询资源；接纳必须核对目标、资源字段、请求顺序与生命周期。
- 势力创建必须由正式构造器提供 logo、displayNameWithArticle、names、portraits 和 RGBA color，并使用游戏 UI 颜色字段。
- 势力加载身份必须消费规格内容的字符串 id；索引必须提供实际文件目标，读取、版本、保存与删除必须消费同一授权路径。
- 势力索引修改必须保留表头、行位置与业务列，只允许更新所属 ID 和引用字段。
- 原版编辑权限必须消费持久化 `AppSettings.allowCoreEditing` 和完整设置镜像，缺省必须为关闭。
- 各实体的打开入口必须命中对应后端实体定义的目录与扩展名。
- 同 session 刷新必须共同接纳内容和版本凭据；dirty 草稿必须共同暂存外部内容与凭据，载入外部版本必须共同交接。
- 外部删除当前 dirty 目标时必须保留编辑面并呈现删除提示；确认放弃后必须交接到所属首项。
- 外部版本载入与实体选择必须等待所属保存，成功后必须按最新 dirty 确认；确认必须绑定发起目标并取消所属输入。
- 实体 View 必须持续持有列表与文档区域，Editor 必须承载所属目标内容并只读交付 handoffLocked。
- 当前展示目标必须消费工作区的当前项目投影，异步动作必须捕获并持续消费所属 Mod 根与 session。
- 改变目标的配置动作必须短暂锁定当前编辑面；按钮与保存快捷键必须共同消费锁定，结束后必须释放。
- 整体内容的 inert 必须由 View 合成动作锁与编辑器交接锁，所属会话与 Mod 身份必须决定编辑器生命周期。
- 界面刷新必须由所属根登记实际来源与动作，并沿现有保存等待、草稿和外部更新接纳流程执行。
- 结构化 JSON 保存必须使用设置快照选择原样更新或规范化写入；原样更新无法安全完成时必须在写入前确认影响文件。
- 表单双向绑定必须经统一 Draft Session setter 提交；校验拒绝与保存取消必须返回 `null`，严禁提交成功基线或触发保存成功回调。
- 装配 modules 读取、设置和改名必须消费实体纯规则，必须保留对象或有序条目数组的格式、顺序和未知业务字段。
- 装配改名必须协调父引用的活动输入、相关保存及实际版本；主文件与全部父装配 modules 引用必须原子提交并共同回放，后续同步必须消费完整 receipt。
- 配置保存的传输内容必须消费 `IndexedConfigEntityRefresh`；编辑数据必须由所属投影共同接纳回执版本。
- 配置列表必须以 `sessionId` 与 `modRoot` 共同归属数据、版本凭据、资源引用和选择；身份切换必须同步清空这些状态，新列表到达后才允许建立编辑目标。
- 配置编辑会话必须登记实际版本覆盖的文件范围及所属保存动作；联合交接必须保留配置身份和动作 owner。
- 配置编辑器生命周期必须按 session 与 Mod 隔离；同名实体切换必须加载目标基线，保存回调严禁读取其他 Mod 的活动目标。
- 配置读取必须消费实体查询能力的只读记录；列表记录和编辑模型必须由领域 mapper 生成独立内容、目标和版本快照。
- 重命名必须同时更新索引行、实体文件与文件名，并保持 history 可回放。

## 陷阱

- 保存后用请求前快照提交 base 会覆盖请求期间的新编辑。
- 列表对屏幕外图片发起 data URL 查询会造成 IPC 风暴。
- 删除实体不清理索引行会留下悬空索引引用。
- 前端扫描 Mod 目录补列表会让实体身份脱离后端索引。
- 让组件直接调用写 service 会绕过保存编排与文件历史。
