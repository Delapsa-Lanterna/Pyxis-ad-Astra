# 沉浸式武器编辑器

## 定义

沉浸式武器编辑器模块提供武器信息、统计、分支动作及弹体与开火预览打开交接。

## 参考

### 拥有

- `src/app/components/immersive/ImmersiveHighlightedText.vue`：武器说明高亮文本展示。
- `src/app/components/immersive/weapon/`：武器信息与弹体及开火预览事件展示。
- `src/app/components/immersive/weapon/WeaponImmersivePanel.vue`：武器内容与弹体及开火预览事件入口。
- `src/app/composables/immersive-editor/weapon/`：武器分支、弹体及开火预览动作。
- `src/app/composables/immersive-editor/weapon/use-immersive-weapon-editor.ts`：分支覆盖、弹体及开火预览动作。
- `src/domain/immersive/weapon/`：武器字段、统计与信息投影。
- `src/domain/immersive/weapon/weapon-panel.ts`：武器字段、说明、图标来源、分支投影及弹体与贴图关联查询输入投影。
- `src/domain/immersive/weapon/weapon-statistics.ts`：武器周期、弹药与伤害统计纯规则。

### 消费

- `src/app/components/immersive/ImmersiveFallbackIcon.vue`：伤害类型、插件与甲板的共用缺省图标。
- `src/app/components/immersive/ImmersivePanelRow.vue`：共同字段行及标签排布。
- `src/app/components/immersive/ImmersivePanelSources.vue`：面板来源记录展示。
- `src/app/components/immersive/ImmersiveSection.vue`：共同内容分组及标题展示。
- `src/app/components/immersive/ImmersiveText.vue`：沉浸式文本片段与字体角色展示。
- `src/app/components/immersive/ImmersiveWeaponIcon.vue`：武器图层与已装载导弹的缓存图标展示。
- `src/app/components/immersive/immersive-render-context.ts`：只读与编辑展示契约。
- `src/app/composables/immersive-editor/use-immersive-editor-runtime.ts`：联合会话、历史、字段与关联读取运行态。
- `src/app/composables/use-app-feedback.ts`：窗口反馈的提供与消费入口。
- `src/domain/entity-write/spec-construction.ts`：前端规格、装配和皮肤构造及分支补全。
- `src/domain/immersive/design-type.ts`：设计类型名称及颜色规则。
- `src/domain/immersive/fields.ts`：字段规则、数值投影与具名关联查询输入契约。
- `src/domain/immersive/highlighted-text.ts`：说明文本的高亮片段纯投影。
- `src/domain/immersive/source-records.ts`：可编辑来源与装配记录选择。
- `src/domain/joint-edit.ts`：联合写入范围提取、身份映射、草稿重接与冲突选择投影。
- `src/domain/schema/config-schema-registry.ts`：字段与列资产加载、来源声明、值及结构纯规则。
- `src/domain/schema/csv-schema-registry.ts`：字段与列资产加载、来源声明、值及结构纯规则。
- `src/domain/schema/csv-value-validation.ts`：字段与列资产加载、来源声明、值及结构纯规则。
- `src/domain/schema/schema-values.ts`：字段与列资产加载、来源声明、值及结构纯规则。
- `src/stores/settings.store.ts`：settings 运行态，只持状态、setter 与派生值；初始快照经统一初始化入口注入。
- `src/test/fixtures/joint-edit/weapon-joint-edit.ts`：武器联合来源与规格的测试构造。
- `src/windows/spec-editor.window.ts`：四类规格的身份、尺寸与结构化窗口请求。
- `src/windows/weapon-fire-preview.window.ts`：独立武器草稿的开火预览窗口交接。

## 边界

- 共同运行态拥有联合草稿、历史与保存。
- 内容组件通过显式事件请求打开所属弹体与开火预览。
- 分支动作消费当前会话输入与独立业务值。
- 只读候选消费武器内容与静态图标投影。
- 武器实现拥有说明、派生统计及覆盖选择。

## 链路

### 武器内容与分支

1. 武器定义投影规格、CSV、描述和弹体关联。
2. 字段转换按武器分支规则补齐必读内容。
3. 覆盖动作确认当前来源及合法分支后交付联合会话。
4. 内容组件共同呈现编辑窗口与只读候选。

### 打开弹体与开火预览

1. 弹体与开火预览入口交付武器专属动作。
2. 动作提交活动输入并核对捕获的会话。
3. 弹体动作读取当前引用并交付 Spec 弹体窗口，开火预览动作克隆当前武器规格并交付 draft 来源。

## 规范

- pulse 来源覆盖必须由联合保存共同确认合法分支、来源、目标与共享影响，实际分支转换绑定本次提交，取消保留原内容。
- 分支转换必须经所属字段规则交付独立草稿，未知业务字段保留。
- 弹体与开火预览动作必须归武器实现，基础展示协议严禁承载该动作。
- 弹体与开火预览打开必须提交活动输入并核对目标与接纳权；开火预览交付独立武器规格快照。
- 武器描述必须以武器 ID 与 `WEAPON` 类型定位，用途优先消费 `primaryRoleStr`，再消费描述 `text2`；派生值和覆盖文本共同绑定实际来源参数。
- 武器来源必须以 CSV 提供名称、性能及伤害类型，以规格提供类型、尺寸、挂载和发射参数；弹体只允许作为只读关联和独立编辑目标。
- 武器统计必须消费原版发射点、模式、充能、连射、光束周期与弹药恢复规则；高亮只允许作为逐字片段展示，严禁解释为 HTML。
- MIRV 统计必须直接消费 behaviorSpec 的 damage、numShots 与 emp；伤害或数量缺失时采用武器表基础伤害并交付具体诊断，伤害与 EMP 展示保留每枚后续弹体及发射数量的拆分，后续弹体参数通过所属弹体编辑入口修改。
- 连射光束必须展示充能、衰减、发射持续与冷却之和，周期编辑共同绑定所属四项武器表字段。
