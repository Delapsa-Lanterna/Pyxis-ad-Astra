# 联合编辑与目标交接

## 定义

联合编辑与目标交接模块协调多来源草稿、编辑面交接和原子保存。

## 参考

### 拥有

- `schemas/skin-hull-fields.json`：基础舰船属性与皮肤覆盖字段的统一映射声明。
- `src-tauri/src/commands/joint_edit.rs`：联合读取、准备、提交 command。
- `src-tauri/src/domain/joint_edit.rs`：三方业务值比较与冲突投影。
- `src-tauri/src/domain/joint_hull.rs`：有效船体字段来源、Skin 继承与有效武器槽的纯投影。
- `src-tauri/src/services/project/query/joint_edit.rs`：四类根、来源图、CSV 目录及版本装配。
- `src-tauri/src/services/project/write/joint_edit.rs`：联合当前来源图准备、身份与修改接纳及实际保存。
- `src/app/components/JointEditConflictChoices.vue`：三个来源与字段选择展示。
- `src/app/composables/use-edit-target-handoff.ts`：窗口接收与目标登记生命周期。
- `src/app/composables/use-joint-edit-actions.ts`：确认、冲突选择和领域动作装配。
- `src/app/composables/use-joint-edit-session.ts`：消费编辑会话原语的联合目标适配器。
- `src/domain/joint-edit.ts`：联合写入范围提取、身份映射、草稿重接与冲突选择投影。
- `src/orchestrators/joint-edit.orchestrator.ts`：联合读取、冲突确认与提交顺序。
- `src/services/joint-edit.service.ts`：三个 command 的类型化协议装配。

### 消费

- `src-tauri/src/domain/entity_construction.rs`：缺失规格的正式构造。
- `src-tauri/src/domain/variant_modules.rs`：装配模块格式的读取和引用替换。
- `src-tauri/src/models/joint_edit.rs`：联合来源记录、缺失值、冲突与提交模型。
- `src-tauri/src/models/joint_target.rs`：联合业务根、类别与所属项目范围。
- `src-tauri/src/models/project_identity.rs`：联合来源消费的实体、CSV 表与版本身份。
- `src-tauri/src/models/write_commit.rs`：联合提交消费的公共回执与行键映射。
- `src-tauri/src/services/project/model.rs`：来源装配消费的已加载记录。
- `src-tauri/src/services/project/query/json_layers.rs`：会话所属的正式有序 JSON 来源组合与版本。
- `src-tauri/src/services/project/resources/entity_references.rs`：联合内容及提交结果的实体资源引用。
- `src-tauri/src/services/project/resources/resource_identity.rs`：联合查询按实际规格来源接纳资源集合的引用身份。
- `src-tauri/src/services/project/session/csv_writes.rs`：所属表格写入缓冲与成功接纳。
- `src-tauri/src/services/project/sources/`：带版本来源读取与共享 Core 文档成果。
- `src-tauri/src/services/project/write/entity_write.rs`：实体暂存、描述及父引用的写入规则。
- `src/app/WindowRuntime.vue`：显式交付窗口反馈并挂载目标交接。
- `src/domain/edit-session.ts`：保存准备与跨窗口请求消费的目标重叠比较。
- `src/domain/project/entity-definitions.ts`：实体内容 ID 字段及字符串 ID 提取。
- `src/domain/schema/csv-schema-registry.ts`：CSV 记录消费的正式列声明。
- `src/domain/schema/csv-value-validation.ts`：联合 CSV 草稿与保存内容消费的共同值规则。
- `src/orchestrators/entity-write.orchestrator.ts`：实体本地 ID 状态变化的统一确认。
- `src/orchestrators/json-write-confirmation.orchestrator.ts`：保存提交所属的原文保留、逐源确认和写入重试。
- `src/shared/lib/starsector/variant-modules.ts`：前端装配模块格式及身份映射。
- `src/shared/types/joint-edit.types.ts`：前端联合记录、冲突及交接协议。
- `src/shared/types/write-commit.types.ts`：公共保存回执、提交同步、行键映射与正式内容交付。
- `src/stores/save-command.store.ts`：所属保存句柄、独立草稿和关闭等待登记。
- `src/test/fixtures/entity-target.ts`：正式实体目标及版本的测试构造。
- `src/test/fixtures/joint-edit/joint-record.ts`：四类联合样本共用的记录、来源、版本与草稿构造。
- `src/test/fixtures/joint-edit/ship-joint-edit.ts`：舰船联合快照及所属来源记录的测试构造。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。

### 关联

- `src/shared/lib/row-data.ts`：JSON 对象形状判断及错误交接。
- `src/shared/lib/stable-compare.ts`：结构化值的稳定序列化及相等判断。
- `src/shared/types/json.types.ts`：JSON 业务值与输入形状契约。

## 边界

- 业务根与物理范围分别表达，同文件记录共享版本和交接范围。
- 保存参与者登记所属目标、输入提交、等待和保存动作；主窗口覆盖已初始化的 CSV 运行态。
- 前端领域声明可编辑记录并投影独立草稿，基线、关联和候选读取分别拥有接纳通道。
- 原生窗口能力拥有实例 label、登记、聚焦和预约，联合模块消费这些能力。
- 各 CSV、配置、文本与专项会话拥有所属草稿、输入、dirty、saving 和历史。
- 后端 query 拥有来源图、记录、授权目标和版本，write 拥有同根 changeset 与实际快照。
- 有效船体字段由基础船体和有序皮肤来源共同定义，实际规格、贴图、槽位、引擎与 hints 按基础至有效皮肤顺序合成。
- 窗口壳装配目标接收与登记生命周期，manifest 和会话释放交还所属登记。
- 联合编排拥有按业务目标捕获的修改、所属确认、目标预约与释放。

## 链路

### 联合读取

1. 动作以 session、Mod、种类和 ID 请求联合来源快照。
2. 后端以根租约读取规格、CSV、描述、Core 补集、Skin 和模块来源。
3. 来源目录按类型及表准备，返回记录身份、来源版本、写入目标和引用关系。
4. 编排交付所属读取结果，其他窗口草稿保持独立。
5. 编辑会话建立独立草稿与基线。

### 目标交接

1. 请求捕获所属联合目标及完整修改。
2. 原生登记维护所属编辑目标和窗口身份。
3. 项目队列按接收顺序执行文件事务。
4. 保存结果共同交付受影响窗口，所属内容维护者按顺序接纳。

### 冲突与提交

1. 后端比较原始基线、权威磁盘和提交草稿。
2. 独立字段合并，重叠差异返回结构化冲突。
3. 用户按字段选择磁盘或草稿，确认共享影响及 Mod 覆盖。
4. 命令取得根事务并核对确认版本。
5. write 装配规格身份、CSV 记录及描述到同一 changeset，完成 JSON 确认后原子应用。
6. 返回实际快照、身份、行键、版本及文件历史；项目同步先接纳历史、清单及缓存，再完成所属会话与相关窗口的内容交接。

## 规范

- 联合保存必须按冲突选择后的实际修改记录消费实体写入校验，失败保留原始码、实际文件、CSV 行键与字段路径；问题聚合消费所属输入集合，修正及基线交接清理所属保存失败。
- 联合 CSV 记录必须按正式列声明消费共同值规则，问题汇总、捕获保存内容及冲突选择后的实际内容共同检查；字段原文与所属草稿历史保持原有归属。
- 冲突必须逐字段通过下拉选择并展示所选完整内容，三份完整来源支持展开查看；身份、覆盖、共享影响与武器分支共同审阅，取消保持原草稿。
- 联合保存必须在冲突选择完成后，按实际物理文件汇总本地 ID 有无变化，并消费实体写入的统一确认能力。
- 联合规格的局部覆盖校验必须消费各文件的本地身份；确认与事务共同消费准备后的内容和版本。
- CSV 暂存必须先合并规格身份、字段、描述及注释首列，再按最终表各渲染一次；回执与会话消费同一最终表和实际提交文本。
- CSV 来源目录必须一次准备所属表的身份索引；行键匹配保持注释身份与 description 的 id/type 组合。
- CSV 补列必须以明确字段提交为依据；标准列按已配置 Core 表头或正式列资产排序，自定义列保持相对顺序并位于末尾。
- CSV、配置、文本与专项保存参与者必须登记完整物理范围，输入、dirty、saving 和历史保持所属会话 owner；原生目标登记只允许由窗口能力维护。
- Core 来源必须携带来源版本与当前 Mod 创建凭据；覆盖修改经显式确认并写入授权 Mod 目标。
- `JointEditQuery` 必须分别承载正式根、可选 CSV `rowKey`、草稿值、`newSources` 与可选 catalog；`rowKey` 由后端解析已保存 ID，草稿关联投影消费独立捕获值。
- `JointEditRoot` 必须完整表达 `sessionId`、`modRoot`、kind 和 id；四类根为 ship、weapon、wing 与 variant。
- `JointHull` 必须表达装配、基础船体、Skin 链、实际字段绑定、逐船体 CSV／描述／系统展示绑定、完整有效槽位、有效 hints、内置装备、模块定位与授权贴图；有效值按继承顺序投影，字段提交消费所属 `recordKey` 与 path，展示绑定指向同一来源图中的实际记录键。
- `JointRecordTarget` 必须分别表达规格、CSV 与文本；CSV 具有 table、`rowKey`、业务 identity 和授权 write。
- `JointValue` 必须区分 missing 与 present；`null`、删除、数组和文本原文保持各自语义。
- Mod 写入版本必须保持所属根范围；Core 来源消费独立 `sourceVersion` 核对，授权 Mod 覆盖目标保留不存在凭据。
- Skin 缺少 `descriptionId` 时必须消费 `skinHullId`，显式空引用呈现缺失状态；恢复默认描述通过明确字段移除动作提交。
- `newSources` 只允许声明关联图中的 ship、variant 与 skin 创建类型及 ID；准备必须捕获新增关联的 Mod 版本，保存核对原目标与不存在凭据。
- `query_joint_edit` 的 catalog 请求必须返回 `JointVariantCatalogRead`；目录直接读取所属类型及配置，战机联队预览在一次来源图内按实际 ID 去重并消费有效船体投影，返回来源、版本和 `ResourceRef`。可写基线消费 `JointEditSnapshot` 与原权威查询。
- `referenceSettings` 必须共同提供 Core／Mod 的幅能参数、引擎样式、UI 资源及配置版本；`ResourceRef` 由后端授权，展示消费者分别登记媒体集合。
- variants 必须按实际装配记录键提供根与关联装配的有效投影；catalog 只允许按请求种类返回武器、战机联队或插件的元数据、来源、资源与版本。
- 三方比较必须按对象字段路径与 CSV 记录内容执行，数组与文本整体选择；独立修改保留两侧业务内容。
- 保存期间新增编辑及草稿撤销重做必须独立保留，正式结果接纳保留捕获后的草稿差异。
- 保存确认必须绑定当前版本，确认后的来源变化返回版本冲突并保留草稿。
- 共享关系必须沿船体、Skin 与装配反向展开至实际战机联队；确认呈现实际来源、写入文件与关联对象。
- 战机联队 CSV 改名必须以原 `rowKey` 解析权威 ID，描述身份继续消费实际船体来源；引用提交后按实际磁盘重读新的来源与版本。
- 根与模块改名必须共同映射实际记录键、引用定位、草稿与历史；父引用写入接纳实际版本并进入同一文件历史与保存事件。
- 模块引用必须消费原版对象和有序条目数组的正式格式；读写保留加载格式、顺序、共享记录身份和未知字段。
- 武器描述必须按武器 ID 与 `WEAPON` 类型读取；武器 ID 改名在同一事务中更新所属描述记录，目标描述占用拒绝整次保存。
- 皮肤根必须保持真实 skin 身份，保存、改名与权威来源重读共同接纳其有序字段来源和实际生效规格。
- 目标适配器必须声明可编辑记录集合；草稿、三方比较、共享影响确认与保存协调只允许消费该集合。
- 联合基线的写后重读必须消费提交通知的投影阶段，并等待身份阶段完成；所属会话释放撤销基线与关联读取。
- 联合提交必须只应用一次 changeset、登记一次文件历史；写后结果由实际 after 快照装配版本。
- 联合保存必须在所属根租约内一次构造当前来源图，修改应用、目标映射及写入消费该图，实际写入前核对所属来源凭据。
- 已读取规格及 CSV 缺失时必须保留当前完整内容，重建确认后共同应用捕获修改并保留其他记录。
- 联合保存必须按实际来源读取必要原版内容，Mod 内容齐全时支持无原版保存。
- 联合武器关联投影必须按当前草稿的 `projectileSpecId` 与伤害类型返回弹体来源和配置授权图标；配置版本参与关联失效。
- 船体属性必须消费统一皮肤字段映射，来源按基础与继承链有序交付；舰队点数优先采用 fleetPoints 再采用 fpMod，价值先采用 baseValue 再应用 baseValueMult 并截取整数。
- 装配身份改名必须在同一根事务中更新当前 Mod 全部父装配 modules 引用；读取版本与交接目标覆盖父文件，配置、文本和联合写入共同消费该规则。
- 默认舰船描述键必须由所属身份规则随 `hullId` 改名；联合提交接纳描述记录的实际 ID、行键、bindings 与版本，显式 `descriptionId` 只允许由明确字段动作改变。
