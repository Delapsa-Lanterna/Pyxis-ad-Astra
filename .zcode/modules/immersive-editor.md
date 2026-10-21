# 沉浸式编辑器基础

## 定义

沉浸式编辑器基础模块提供共同会话装配、字段展示、来源规则与舰体场景。

## 参考

### 拥有

- `src/app/components/immersive/ImmersiveEditorActions.vue`：共同保存、撤销及外部载入动作展示。
- `src/app/components/immersive/ImmersiveEditorShell.vue`：共同标题、来源、状态与业务插槽。
- `src/app/components/immersive/ImmersiveFallbackIcon.vue`：伤害类型、插件与甲板的共用缺省图标。
- `src/app/components/immersive/ImmersiveFieldInput.vue`：所属字段能力的数值、选择与文本输入。
- `src/app/components/immersive/ImmersiveFieldPopover.vue`：沉浸式字段弹出编辑、原文及提交交接。
- `src/app/components/immersive/ImmersiveHullScene.vue`：舰体场景的媒体、导航与绘制装配。
- `src/app/components/immersive/ImmersiveHullThumbnail.vue`：必须通过正式舰体绘制交付静态成品。
- `src/app/components/immersive/ImmersivePanelRow.vue`：共同字段行及标签排布。
- `src/app/components/immersive/ImmersivePanelSources.vue`：面板来源记录展示。
- `src/app/components/immersive/ImmersiveRenderers.spec.ts`：多类内容布局、只读展示与正式字段协议验证。
- `src/app/components/immersive/ImmersiveSection.vue`：共同内容分组及标题展示。
- `src/app/components/immersive/ImmersiveSourceNotice.vue`：来源定位与业务补全事件交接。
- `src/app/components/immersive/ImmersiveStatRow.vue`：统计标签、字段能力与原版字体展示。
- `src/app/components/immersive/ImmersiveText.vue`：沉浸式文本片段与字体角色展示。
- `src/app/components/immersive/ImmersiveWeaponIcon.vue`：武器图层与已装载导弹的缓存图标展示。
- `src/app/components/immersive/immersive-render-context.ts`：只读与编辑展示契约。
- `src/app/composables/immersive-editor/use-immersive-editor-runtime.ts`：联合会话、历史、字段与关联读取运行态。
- `src/app/composables/immersive-editor/use-immersive-thumbnails.ts`：必须交付武器与舰体缩略图的实际绘制参数、依赖和成品需求。
- `src/app/renderers/immersive/`：共同挂载形状与舰体层序绘制。
- `src/app/renderers/immersive/weapon-mount.ts`：挂载形状的无状态 Canvas 绘制。
- `src/assets/immersive/damage/`：伤害类型的本地回退资产。
- `src/assets/immersive/icons/`：插件与甲板的本地回退资产。
- `src/domain/immersive/appearance.ts`：沉浸式缩放、主题与颜色投影。
- `src/domain/immersive/design-type.ts`：设计类型名称及颜色规则。
- `src/domain/immersive/editor-definition.ts`：四类联合根的名称、字段定义与写入规则。
- `src/domain/immersive/fields.ts`：字段规则、数值投影及共同定义契约。
- `src/domain/immersive/font-roles.ts`：沉浸式文本角色到字体样式的投影。
- `src/domain/immersive/highlighted-text.ts`：说明文本的高亮片段纯投影。
- `src/domain/immersive/hull-scene.ts`：有效舰体、装备层序、坐标与编队投影。
- `src/domain/immersive/source-records.ts`：可编辑来源与装配记录选择。
- `src/domain/immersive/weapon-icon.ts`：挂载颜色与形状纯投影。
- `src/orchestrators/immersive-editor.orchestrator.ts`：联合根读取、编辑目标准备与沉浸式窗口交付。
- `src/windows/immersive-editor.window.ts`：完整联合身份、联队 rowKey 和窗口尺寸请求。

### 消费

- `src/app/composables/use-joint-edit-session.ts`：消费编辑会话原语的联合目标适配器。
- `src/domain/json-editor/json-file-defaults.ts`：装配与皮肤的初始 JSON 内容。
- `src/domain/json-editor/json-variant-modules.ts`：装配模块字段的对象/数组读取与写回。
- `src/domain/project/entity-definitions.ts`：实体内容 ID 字段及字符串 ID 提取。

### 装配

- `src/app/ImmersiveEditorContent.vue`：四类沉浸式组件、共同会话及业务事件装配。
- `src/app/composables/immersive-editor-assembly.ts`：实现选择、保存门禁与展示适配。

## 边界

- 共同运行态拥有联合会话、历史、来源读取与释放。
- 只读与编辑模式共同消费所属内容布局。
- 字段协议提供原文、来源、展示和提交语义。
- 应用装配选择业务实现并交接展示协议。
- 来源选择提供所属可编辑集合，联合模块拥有实际保存和物理协调。
- 舰体场景拥有共用坐标、装备展示、媒体、引擎着色成品引用和导航。

## 链路

### 窗口与字段

1. 窗口内容按实际种类建立定义与共同运行态。
2. 业务实现接入所属动作，应用装配建立展示适配。
3. 字段原文提交后更新所属来源，历史接纳同一次业务动作。
4. 保存经联合会话完成正式事务与身份交接。

### 关联与释放

1. 来源和字段变化按所属票据读取关联投影。
2. 媒体与图像按实际资源身份接纳，场景消费当前结果。
3. 外部内容由联合会话接纳或暂存。
4. 窗口释放输入、历史、监听、媒体和读取。

## 规范

- Core 修改必须通过明确来源选择与覆盖确认，缺失记录必须消费正式构造器和授权目标；缺失字段必须由显式字段提交建立。
- `FieldInputs` 必须登记手填引用与临时调整；保存必须等待异步 finalizer 并消费接纳结果，取消或错误必须阻断当前保存并保留所属原文。
- `JointEditRoot` 必须完整表达 `sessionId`、`modRoot`、kind 与 id；联队行身份必须由 CSV `rowKey` 解析，身份接纳必须共同映射窗口、草稿、输入和历史。
- `ReadTicket` 必须分别管理联合基线、关联、目录、候选详情与动作确认；引用替换、失效、目标变化、销毁和 session 关闭必须释放所属等待与接纳权。
- 位图展示必须保留 DOM 可访问名称；DPI 和窗口重排必须保持逻辑字号、物理像素对齐、浮层目标与活动输入。
- 共享场景必须消费显式几何与资源，Canvas 调用必须归应用渲染层。
- 共享字段组件只允许提交所属来源记录；多字段浮层必须在全部原文有效后一次交付字段集合，并登记一条联合历史。
- 共同运行态必须唯一拥有联合会话与历史，业务实现必须消费原引用。
- 内容渲染器必须显式消费只读或编辑模式；编辑模式必须由所属会话提供字段能力，只读模式只允许消费投影、来源与媒体结果。
- 只读信息必须消费所属领域内容投影，草稿、原始输入、历史、保存及目标登记必须归所属编辑会话。
- 字体选择必须经领域角色映射交付实际身份，文字与截断测量必须消费字体模块的同一排布能力。
- 字段身份必须使用稳定来源角色与路径；单行输入必须以 Enter 提交、Esc 取消，多行描述必须以 Ctrl+Enter 提交，未完成输入必须参与 dirty、保存和关闭交接。
- 对话层必须拥有所属点击和焦点边界，字段与类别浮层必须挂载在所属 dialog；返回必须交接活动字段、取消手填输入并恢复发起入口焦点。
- 展示协议必须与完整 VM 类型分离，VM 适配必须归应用装配。
- 引擎必须消费共享装配静止成品与资源运行态，主舰和递归模块必须共同应用所属坐标变换及有效舰体 hint 决定的层序。
- 引用切换必须提交输入、等待保存与同步并确认当前相关草稿；提交后必须权威重读来源、版本与资源，取消或提交失败必须保留原引用和草稿。
- 打包 SVG 必须由所属展示入口静态导入；本地引擎解码必须在 WebView 内共享，场景等待必须消费所属读取票据。
- 沉浸式基础统计必须明确插件零效果口径；派生项必须提供公式和来源，编辑动作必须提交实际来源参数。
- 界面刷新必须由所属根登记实际来源与动作，并沿现有保存等待、草稿和外部更新接纳流程执行。
- 稳定详情身份必须保持渲染实例；候选在可视区及上下各一个视口的提前量内按需挂载并在选择器内持续驻留，读取必须消费现有缓存与 single-flight，选择器关闭和身份替换必须释放所属实例、票据与媒体等待。
- 系统引用必须消费正式来源选项，说明必须读取所属 `SHIP_SYSTEM` 静态描述；关联武装和插件必须消费有效来源投影。
- 资源必须消费后端授权 `ResourceRef` 和所属媒体集合；场景、图标与槽位命中必须共用正式坐标、层序和有效 Skin 来源，解码接纳必须服从当前生命周期。
- 静态武器与舰体缩略图必须向资源运行态交付成品需求，绘制必须消费所属正式 renderer；交互场景必须按实际需求持有原图。

## 陷阱

- 以完整业务 VM 定义基础展示接口会使依赖方向反转。
- 复制联合草稿或历史会使保存和关闭判定分叉。
- 让场景持有装备修改会扩大绘制能力的职责。
