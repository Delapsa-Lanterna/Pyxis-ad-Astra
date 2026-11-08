# 沉浸式战机联队编辑器

## 定义

沉浸式战机联队编辑器模块提供战机联队信息、有效船体展示、来源补全、行身份跟随及关联沉浸式编辑器打开。

## 参考

### 拥有

- `src/app/components/immersive/wing/`：战机联队信息与来源展示。
- `src/app/components/immersive/wing/WingImmersivePanel.vue`：战机联队内容及来源字段展示。
- `src/app/composables/immersive-editor/wing/`：战机联队 rowKey、来源补全和业务动作。
- `src/app/composables/immersive-editor/wing/use-immersive-wing-editor.ts`：按 rowKey 读取、来源补全、身份跟随及关联编辑器打开。
- `src/domain/immersive/wing/`：战机联队来源、字段和编队纯投影。
- `src/domain/immersive/wing/wing-panel.ts`：技术信息、来源绑定与编队输入投影。

### 消费

- `src/app/components/immersive/ImmersiveHullScene.vue`：船体场景的媒体、导航与绘制装配。
- `src/app/components/immersive/ImmersivePanelRow.vue`：共同字段行及标签排布。
- `src/app/components/immersive/ImmersivePanelSources.vue`：面板来源记录展示。
- `src/app/components/immersive/ImmersiveSection.vue`：共同内容分组及标题展示。
- `src/app/components/immersive/ImmersiveText.vue`：沉浸式文本片段与字体角色展示。
- `src/app/components/immersive/immersive-render-context.ts`：只读与编辑展示契约。
- `src/app/composables/immersive-editor/use-immersive-editor-runtime.ts`：联合会话、历史、字段与关联读取运行态。
- `src/app/composables/use-app-feedback.ts`：窗口反馈的提供与消费入口。
- `src/domain/entity-write/spec-construction.ts`：前端规格、装配和皮肤构造及分支补全。
- `src/domain/fonts/font.types.ts`：字体身份、文本片段、位图对象与排布结果的纯类型。
- `src/domain/immersive/design-type.ts`：设计类型名称及颜色规则。
- `src/domain/immersive/fields.ts`：字段规则、数值投影与具名关联查询输入契约。
- `src/domain/immersive/highlighted-text.ts`：说明文本的高亮片段纯投影。
- `src/domain/immersive/hull-fields.ts`：船体基础与皮肤字段的统一读取、计算与输入投影。
- `src/domain/immersive/hull-scene.ts`：有效船体、装备层序、坐标与编队投影。
- `src/domain/immersive/source-records.ts`：可编辑来源与装配记录选择。
- `src/domain/joint-edit.ts`：联合写入范围提取、身份映射、草稿重接与冲突选择投影。
- `src/domain/schema/config-schema-registry.ts`：字段与列资产加载、来源声明、值及结构纯规则。
- `src/domain/schema/csv-schema-registry.ts`：字段与列资产加载、来源声明、值及结构纯规则。
- `src/domain/schema/csv-value-validation.ts`：字段与列资产加载、来源声明、值及结构纯规则。
- `src/domain/schema/schema-values.ts`：字段与列资产加载、来源声明、值及结构纯规则。
- `src/orchestrators/immersive-editor.orchestrator.ts`：联合根读取、编辑目标准备与沉浸式窗口交付。
- `src/services/joint-edit.service.ts`：三个 command 的类型化协议装配。
- `src/test/fixtures/joint-edit/wing-joint-edit.ts`：战机联队联合来源及行键的测试构造。
- `src/windows/immersive-editor.window.ts`：舰船与装配沉浸式窗口身份及打开请求。

## 边界

- 共同来源规则提供战机联队可编辑记录集合。
- 基础运行态拥有联合会话、字段、历史及释放。
- 战机联队实现拥有舰船与 Skin 来源补全、引用定位、行身份重读、重命名接纳和关联编辑器打开。
- 战机联队投影提供角色、防御、系统、来源与编队参数。
- 有效船体与装备由共同船体场景展示。

## 链路

### 战机联队读取与展示

1. 宿主捕获战机联队 rowKey 并建立所属联合会话。
2. 战机联队读取按当前行身份交付有效来源图。
3. 投影交付技术信息及编队输入，共同场景绘制船体和装备。

### 战机联队身份跟随

1. 来源更新进入所属身份读取通道。
2. 保存等待与确认完成后重读当前行的权威身份。
3. 会话与窗口共同接纳新身份，草稿和历史按实际来源映射。

### 关联编辑器打开

1. 舰船与装配按钮交付战机联队专属动作。
2. 动作等待保存、提交活动输入并核对目标与接纳权。
3. 舰船动作读取装配所用 ship 或 skin 的真实身份，装配动作读取联队 variant 引用，共同通过正式沉浸式窗口入口交付完整身份。

## 规范

- 补全船体必须通过下拉选择战机船体或皮肤并只展示所选流程及待保存文件；单个确认按钮执行当前选择，身份跟随消费实际联队行的装配引用。
- 关联编辑器打开必须提交活动输入并核对捕获目标；舰船身份消费装配实际 hullId 对应的 ship 或 skin 记录，装配身份消费联队 variant 引用，session 与 Mod 根沿用当前来源。
- 战机联队名称必须消费有效船体名称与装配 `displayName`，并在一次字段动作中提交；用途优先消费 `role desc`，直接参数绑定战机联队 CSV 或有效船体的实际字段来源。
- 战机联队投影必须消费原版角色、swarm 与防御分支；武装汇总按有效槽位统计，甲板、候选和内容渲染器的编队共同消费 `num`、`formation`、有效船体及装备的同一场景投影与绘制。
- 来源补全必须由战机联队动作消费来源展示事件，确认、读取与创建绑定捕获目标和联合基线。
- 身份交接必须映射并保留所属联合草稿与历史。
- 身份重读必须消费当前 rowKey，严禁通过显示名推导实际战机联队。
