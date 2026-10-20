# 字段模式系统

## 定义

字段模式模块将 schema 映射为字段展示、校验和编辑动作。

## 参考

### 拥有

- `schemas/csv/`：CSV 列 schema 资产。
- `schemas/faction.schema.json`：势力字段模式资产。
- `schemas/mission.schema.json`：任务字段模式资产。
- `schemas/mod-info.schema.json`：Mod 信息字段模式资产。
- `schemas/skin.schema.json`：皮肤字段模式资产。
- `schemas/variant.schema.json`：装配字段模式资产。
- `schemas/well-known-labels.json`：well-known 标签资产。
- `src-tauri/src/commands/source_options.rs`：来源目录 command。
- `src-tauri/src/domain/well_known_labels.rs`：well-known 标签资产唯一加载入口，编译期内嵌并校验版本头。
- `src-tauri/src/services/project/query/source_options.rs`：来源选项、分组、授权资源与回退目录查询。
- `src/app/components/schema/`：字段分派、表单、标量原文及行为测试。
- `src/app/components/schema/SchemaFieldRenderer.vue`：字段渲染。
- `src/app/components/schema/SchemaFieldRow.vue`：共同字段行、标签提示内容、直接展示的注意及风险。
- `src/app/components/schema/SchemaFormRenderer.vue`：表单渲染。
- `src/app/components/schema/SchemaScalarInput.vue`：类型文本输入，暂存原文并提交正式字段动作。
- `src/app/components/schema/SchemaValueInput.vue`：类型与模式分派、自身递归及字段更新交付。
- `src/app/composables/editors/use-editor-row-identities.ts`：结构化输入条目的稳定行身份。
- `src/app/composables/editors/use-schema-path-picker.ts`：所属字段文件选择、路径转换与目标接纳。
- `src/app/composables/editors/use-schema-source-options.ts`：字段来源选项读取、失效及释放。
- `src/app/composables/use-input-edit-mode.ts`：输入编辑模式及焦点交接。
- `src/app/composables/use-schema-runtime-context.ts`：所属 session 的字段来源查询与失效订阅装配。
- `src/domain/schema/`：字段模式加载、结构、来源、值及展示纯规则。
- `src/domain/schema/config-schema-registry.ts`：配置 schema 的同步查询入口。
- `src/domain/schema/csv-schema-registry.ts`：CSV 列 schema 的同步查询入口。
- `src/domain/schema/mod-info-schema.ts`：配置与新建 Mod 消费的 Mod 信息资产入口。
- `src/domain/schema/schema-asset-parser.ts`：字段与列资产的版本、形状及来源校验。
- `src/domain/schema/schema-core-fields.ts`：原版字段合并。
- `src/domain/schema/schema-options.ts`：source 分组标签、选项与 `SelectOption` 规则。
- `src/domain/schema/schema-runtime.ts`：runtime 上下文。
- `src/domain/schema/schema-sections.ts`：section 投影与折叠标识。
- `src/domain/schema/schema-values.ts`：字段值转换，拥有标量、kv 条目与业务归一化规则。
- `src/domain/schema/schema.types.ts`：schema 输出类型，拥有字段/控件闭合枚举与 FileSchema/FieldSchema/列 schema 形状。
- `src/domain/tables/csv-source-options.ts`：CSV 字段来源选项与分组投影。
- `src/services/source-options.service.ts`：来源目录协议、查询身份与性能记录。

### 消费

- `src-tauri/src/models/schema.rs`：字段来源请求、选项与来源分组协议。
- `src/shared/lib/input-number.ts`：完整有限浮点与安全整数解析。
- `src/shared/lib/json-fields.ts`：额外 JSON 字段展示条目投影。
- `src/shared/lib/json-input.ts`：字段输入消费的共享 JSON 解析、形状校验与格式化。
- `src/shared/runtime/focus-field-input.ts`：结构化输入的焦点与选择恢复。
- `src/shared/types/core-assets.types.ts`：字段合并消费的 Core 字段发现结果。
- `src/shared/types/schema.types.ts`：字段来源请求、选项与来源分组协议。
- `src/shared/ui/`：数值、JSON、额外字段与颜色输入及其行为测试。
- `src/shared/ui/FieldHints.vue`：描述、注意与风险的共同展示。
- `src/shared/ui/FieldLabel.vue`：显式名称、字段键与完整路径的共同标签。
- `src/shared/ui/FieldRow.vue`：字段、集合、说明与辅助动作的共同展示。
- `src/shared/ui/JsonFieldEditor.vue`：额外字段结构化编辑。
- `src/shared/ui/JsonValueInput.vue`：JSON 原始输入，按声明形状解析并提交。
- `src/shared/ui/NumberValueInput.vue`：Smart 数值原文与正式值提交。
- `src/stores/settings.store.ts`：消费字段解析展开设置。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。

### 关联

- `src/shared/lib/stable-compare.ts`：结构化值的稳定序列化及相等判断。
- `src/shared/lib/starsector/value.ts`：JSON 复制、标量转换与 Mod 版本展示。
- `src/shared/types/json.types.ts`：JSON 业务值与输入形状契约。

## 边界

- `FieldInputs` 与编辑会话接纳延迟提交和模式交接，组件保留输入、焦点和错误。
- schema runtime 拥有字段语义、source、转换和归一化，组件渲染并交付字段动作。
- schema 资产与加载器拥有版本和形状，列资产使用表注册表 key，游戏文件名映射归后端。
- source 目录由后端按声明解析，CSV 来源保持行序，实体来源消费正式清单。
- 原始 JSON 和标量输入归共享控件，解析与形状校验归共享纯模块。
- 嵌套路径、键值和数组身份归字段动作与稳定行原语，额外字段来自业务键集合。
- 舰体内置槽位目录消费 session 和草稿 `baseHullId`，经有效继承投影返回。
- 资源选项交付 `SelectOption` 与 `ResourceRef`，媒体 owner 按展开与当前值读取。

## 链路

### 表单渲染

1. 配置或编辑器页面以合并后 schema 调用表单渲染器。
2. 表单渲染器按 section 投影遍历字段并挂载字段渲染器。
3. 表单输入面接纳设置模式，字段渲染器消费所属输入面的实际模式。
4. 延迟提交控件登记原文，在提交边界解析形状或类型。
5. 字段动作沿嵌套路径设置或删除键并进入 Draft Session。

### 引用与选项

1. 字段声明 source 时渲染器经 runtime 上下文请求选项目录。
2. 选项目录按 `(sessionId, source)` 查询并保持原表行序。
3. 目录外非空值以原始文本同时作为标签与值进入选项。
4. 资源类选项在展开或选中时按需解析缩略图。

### 额外字段

1. 表单渲染器收集模型中未定义字段组成额外字段模型。
2. 结构化编辑器按键类型分派输入控件并支持增删。
3. 更新以整体替换提交回表单模型。

## 规范

- Bundled schema 注册时必须校验每个 `csv:` source 的表名属于正式 CSV 表注册表或实体注册表的 source 声明，无效 source 必须阻止注册。
- Core 根切换必须立即清空所属字段与图形投影；静态 schema 合并必须消费当前根字段，失败时必须保留静态 schema。
- Plain 数字、布尔与 Smart 数字必须登记原文；非法输入必须保留正式字段类型并阻止提交，可选具名字段清空必须删除键，必填字段清空必须定位为错误。
- SchemaFieldRenderer 必须组合共同字段行、说明和值分派；SchemaValueInput 必须自身递归并交付 SchemaFieldUpdate。
- Smart 下拉的选项菜单与已选标签必须共用同一 `SelectOption`。
- `plain` editMode 只允许文本或 JSON 文本；`smart` editMode 才允许增强控件；含换行字符串必须使用 textarea。
- schema 组件严禁写盘或直连 IPC。
- schema 资产必须按配置、CSV 列与 Mod 信息入口加载，资产解析必须复用所属版本、形状与来源校验。
- 不可解析的手输值必须显示逐字符原始文本；空字符串表示未选择。
- 分组必须消费 EditorCollapse 与 Naive 折叠项，默认折叠必须按 schema 身份初始化，首次展开后的隐藏必须保留所属输入。
- 字段名称、字段键与完整路径必须显式交给共同标签，值控件必须消费原文登记与正式提交接口。
- 字段挂载严禁触发选项贴图批量读取；批量解析必须 single-flight 去重。
- 字段描述由字段行按展开设置交给公共 FieldHints 或标签的统一提示；注意与风险始终经公共 FieldHints 直接展示，切换时保留输入节点、原文、焦点与校验。
- 字段默认与数组项默认必须由所属 schema 消费语义决定；完整规格新建必须消费所属格式的共享模板构造。
- 字符串字段只允许提交字符串；Plain 整数必须按完整十进制和安全整数范围解析，浮点必须按完整有限十进制解析，非法文本必须逐字符保留。
- 嵌套字段与键值输出必须保留自有业务键；字段路径读取只允许消费自有属性，构造可写字典必须采用无原型对象。
- 已选值必须按逐字符身份与目录比较，首尾空白完整保留。
- 数组与 key-value 行必须由编辑会话内的稳定身份维护，增删必须对应更新行身份；深拷贝草稿严禁改变现存行节点、焦点和展开态。
- 数组元素清理必须消费所属删除项动作；字段删除必须按稳定行身份取消所属输入子树。
- 未知字段与额外字段必须按正式 JSON 边界保留，严禁丢弃。
- 来源声明或所属 session 清空必须撤销来源通道票据，选项与错误必须在所属通道的接纳回调内发布。
- 来源查询目标变化必须清理旧目录，失败必须经 `AppFeedback` 呈现一次并允许重试；Core 资源门面必须返回响应式 refs。
- 模式替换涉及待提交输入时必须确认放弃；取消必须保留当前输入面，确认必须取消输入并采用最新设置模式。
- 沉浸式复合字段必须由 `FieldInputs` 终结器在全部原文有效后交付一个字段集合；结构化数组必须消费共享 JSON 输入解析，必填分支必须阻止空值提交。
- 沉浸式字段浮层必须消费正式 `FieldSchema`、来源绑定与原始输入协议；多段描述必须各自登记稳定字段身份，提交必须交付所属联合记录更新。
- 装配候选手填 ID 必须登记原始输入并参与 dirty、保存和关闭判定；引用取消必须消费所属输入释放。
- 装配模块浮层必须以正式 slotId 定位模块引用，并保留对象或有序条目数组形态；字段提交必须交给所属联合草稿。
- 路径字段必须消费 pathBase；Mod 路径必须相对 Mod 根，Mission icon 必须相对任务目录，候选目录和选择器必须服从同一基准。
- 选项图片必须按所属菜单可见与邻近集合登记，当前选中值必须独立持有；已接纳解码与缩略图必须消费窗口媒体运行态，关闭必须释放所属引用与等待。
- 颜色文本与面板调整必须登记为同一字段输入；保存必须提交有效颜色，取消必须恢复已提交颜色。
- 颜色面板数值必须先校验原文，复合字段终结器必须随后提交颜色；显式取消必须恢复正式颜色与控件显示。
- 额外字段必须由业务内容与已声明键集合决定；下划线业务键必须完整展示与写回。
- 额外数值字段必须复用 NumberValueInput 的原文提交能力；清空必须删除键，删除动作必须取消所属输入登记。

## 陷阱

- 在渲染组件内二次解析 schema 资产会让形状校验被绕过。
- 把目录外手输值替换为空会让坏引用被静默清除。
- 按下标渲染 kv 行并在删除时手工平移下拉状态会让展开态错行。
- 用字符串替换或正则修复 JSON 会产生不可解释的结构错误。
- 让字段挂载即批量解析贴图会造成 IPC 风暴。
