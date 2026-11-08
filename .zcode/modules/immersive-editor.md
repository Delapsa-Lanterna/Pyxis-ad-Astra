# 沉浸式编辑器基础

## 定义

沉浸式编辑器基础模块提供共同会话装配、字段展示、来源规则与船体场景。

## 参考

### 拥有

- `src/app/components/immersive/ImmersiveEditorActions.vue`：共同保存、撤销及外部载入动作展示。
- `src/app/components/immersive/ImmersiveEditorShell.vue`：共同标题、来源、状态与业务插槽。
- `src/app/components/immersive/ImmersiveFallbackIcon.vue`：伤害类型、插件与甲板的共用缺省图标。
- `src/app/components/immersive/ImmersiveFieldInput.vue`：所属字段能力的数值、选择与文本输入。
- `src/app/components/immersive/ImmersiveFieldPopover.vue`：沉浸式字段弹出编辑、原文及提交交接。
- `src/app/components/immersive/ImmersiveHullScene.vue`：船体场景的媒体、导航与绘制装配。
- `src/app/components/immersive/ImmersiveHullThumbnail.vue`：通过正式船体绘制交付静态成品。
- `src/app/components/immersive/ImmersivePanelRow.vue`：共同字段行及标签排布。
- `src/app/components/immersive/ImmersivePanelSources.vue`：面板来源记录展示。
- `src/app/components/immersive/ImmersiveSection.vue`：共同内容分组及标题展示。
- `src/app/components/immersive/ImmersiveSourceNotice.vue`：来源定位与业务补全事件交接。
- `src/app/components/immersive/ImmersiveStatRow.vue`：统计标签、字段能力与原版字体展示。
- `src/app/components/immersive/ImmersiveText.vue`：沉浸式文本片段与字体角色展示。
- `src/app/components/immersive/ImmersiveWeaponIcon.vue`：武器图层与已装载导弹的缓存图标展示。
- `src/app/components/immersive/immersive-render-context.ts`：只读与编辑展示契约。
- `src/app/composables/immersive-editor/use-immersive-editor-runtime.ts`：联合会话、历史、字段与关联读取运行态。
- `src/app/composables/immersive-editor/use-immersive-thumbnails.ts`：交付武器与船体缩略图的实际绘制参数、依赖和成品需求。
- `src/app/renderers/immersive/`：共同挂载形状与船体层序绘制。
- `src/app/renderers/immersive/weapon-mount.ts`：挂载形状的无状态 Canvas 绘制。
- `src/assets/immersive/damage/`：伤害类型的本地回退资产。
- `src/assets/immersive/icons/`：插件与甲板的本地回退资产。
- `src/domain/immersive/appearance.ts`：沉浸式缩放、主题与颜色投影。
- `src/domain/immersive/design-type.ts`：设计类型名称及颜色规则。
- `src/domain/immersive/fields.ts`：字段规则、数值投影与具名关联查询输入契约。
- `src/domain/immersive/font-roles.ts`：沉浸式文本角色到字体样式的投影。
- `src/domain/immersive/highlighted-text.ts`：说明文本的高亮片段纯投影。
- `src/domain/immersive/hull-fields.ts`：船体基础与皮肤字段的统一读取、计算与输入投影。
- `src/domain/immersive/hull-scene.ts`：有效船体、装备层序、坐标与编队投影。
- `src/domain/immersive/source-records.ts`：可编辑来源与装配记录选择。
- `src/domain/immersive/weapon-icon.ts`：挂载颜色与形状纯投影。
- `src/orchestrators/immersive-editor.orchestrator.ts`：联合根读取、编辑目标准备与沉浸式窗口交付。
- `src/windows/immersive-editor.window.ts`：完整联合身份、战机联队 rowKey 和窗口尺寸请求。

### 消费

- `schemas/skin-hull-fields.json`：船体标量属性与皮肤来源的统一映射。
- `src/app/components/fonts/FontText.vue`：默认 DOM、位图画布、缺字诊断与尺寸监听。
- `src/app/composables/canvas/use-canvas-navigation.ts`：骨架和装配消费的右键平移、滚轮缩放与指针位置。
- `src/app/composables/canvas/use-canvas-runtime.ts`：完整目标身份、悬停、检查器锁定、镜像开关与候选预览。
- `src/app/composables/canvas/use-canvas-selection.ts`：骨架和装配消费的距离命中、选区身份与显式选择。
- `src/app/composables/canvas/use-canvas-surface.ts`：画布表面、导航、视口、选择与指针阶段及其测试。
- `src/app/composables/canvas/use-canvas-viewport.ts`：视口缩放与平移。
- `src/app/composables/editors/use-engine-rendering.ts`：统一装配引擎样式查询、媒体、解码、着色成品与引用释放。
- `src/app/composables/field-editor/use-field-edit-mode.ts`：来源读取、路径选择、输入模式、行身份及选项媒体寿命。
- `src/app/composables/field-editor/use-field-source-options.ts`：来源读取、路径选择、输入模式、行身份及选项媒体寿命。
- `src/app/composables/use-app-feedback.ts`：窗口反馈的提供与消费入口。
- `src/app/composables/use-context-menu.ts`：窗口菜单状态、目标操作、事件生命周期与业务根登记。
- `src/app/composables/use-joint-edit-session.ts`：消费编辑会话原语的联合目标适配器。
- `src/app/composables/use-resource-images.ts`：场景与图片展示的解码引用和迟到接纳。
- `src/app/composables/use-resource-media-registry.ts`：持有集合差量、业务引用、媒体租约与所属反馈。
- `src/app/composables/use-resource-thumbnail.ts`：交付普通缩略图需求与静态成品展示生命周期。
- `src/app/composables/use-snapshot-history.ts`：目标与基线代次绑定的文本和画布快照历史。
- `src/app/composables/use-window-image-runtime.ts`：窗口图片、成品、代次、引用与预读并发。
- `src/app/renderers/editors/canvas-drawing.ts`：清屏、网格与像素贴图的无状态绘制入口。
- `src/app/renderers/editors/engine-renderer.ts`：作为 Spec 与沉浸式引擎静态成品的唯一样式、尺寸与绘制入口。
- `src/app/renderers/editors/weapon-images.ts`：武器编辑、开火预览、舰船与装配消费的共享贴图、装备阶段及光效绘制入口。
- `src/app/renderers/editors/weapon-slot-renderer.ts`：武器槽位与起降口的共同样式、几何和无状态绘制。
- `src/domain/editors/editor-types.ts`：编辑坐标、模式与悬停预览的纯数据类型。
- `src/domain/entity-write/spec-construction.ts`：装配与皮肤的正式初始内容。
- `src/domain/field-editor/field-editor-context.ts`：编辑上下文、候选展示和 CSV 选项索引。
- `src/domain/field-editor/field-options.ts`：编辑上下文、候选展示和 CSV 选项索引。
- `src/domain/fonts/font.types.ts`：字体身份、文本片段、位图对象与排布结果的纯类型。
- `src/domain/joint-edit.ts`：联合写入范围提取、身份映射、草稿重接与冲突选择投影。
- `src/domain/json-composition.ts`：前端内容组合、来源定位、稀疏编辑及覆盖撤销。
- `src/domain/project/entity-definitions.ts`：实体内容 ID 字段及字符串 ID 提取。
- `src/domain/resources/hull-references.ts`：选项及内置槽位的纯投影。
- `src/domain/schema/config-schema-registry.ts`：字段与列资产加载、来源声明、值及结构纯规则。
- `src/domain/schema/csv-schema-registry.ts`：字段与列资产加载、来源声明、值及结构纯规则。
- `src/domain/schema/csv-value-validation.ts`：字段与列资产加载、来源声明、值及结构纯规则。
- `src/domain/schema/schema-source-definitions.ts`：共同字段的来源分类。
- `src/domain/schema/schema-values.ts`：字段与列资产加载、来源声明、值及结构纯规则。
- `src/domain/schema/schema.types.ts`：字段与列资产加载、来源声明、值及结构纯规则。
- `src/domain/settings/theme.ts`：主题令牌与色彩数学，拥有 accent 预设、light/dark 中性色、`createThemeColors` 纯函数及 `THEME_TOKEN_MAP` 的 ThemeColorTokens 与主题属性映射。
- `src/orchestrators/joint-edit.orchestrator.ts`：联合读取、冲突确认与提交顺序。
- `src/orchestrators/project-sync.orchestrator.ts`：窗口内保存消费过程和内容维护者交接。
- `src/services/hull-reference.service.ts`：Hull 查询及引用投影。
- `src/services/joint-edit.service.ts`：三个 command 的类型化协议装配。
- `src/services/source-catalog.service.ts`：联合上下文的候选目录读取与失效判断。
- `src/services/window.service.ts`：窗口 command 的类型化签名与参数装配。
- `src/shared/lib/starsector/variant-modules.ts`：装配模块的共同格式规则。
- `src/shared/runtime/use-layout-frame.ts`：展示尺寸与位置更新的帧合并和作用域释放。
- `src/stores/project-sync.store.ts`：当前待办、错误和项目等待状态。
- `src/stores/settings.store.ts`：settings 运行态，只持状态、setter 与派生值；初始快照经统一初始化入口注入。
- `src/windows/managed.window.ts`：请求交付，等待所属请求的终结回执。
- `src/windows/window-context.window.ts`：只读上下文、请求监听接纳及上下文版本的前端运行态。

### 装配

- `src/app/ImmersiveEditorContent.vue`：五类联合根的沉浸式组件、共同会话及业务事件装配。
- `src/app/composables/immersive-editor-assembly.ts`：实现选择、保存门禁与展示适配。

## 边界

- 共同运行态拥有联合会话、历史、来源读取与释放。
- 只读与编辑模式共同消费所属内容布局。
- 字段协议提供原文、来源、展示和提交语义。
- CSV 字段持有正式列定义，原文提交与计算消费同一解释结果；规格字段直接消费展开后的正式定义。
- 应用装配选择业务实现并交接展示协议。
- 来源选择提供所属可编辑集合，联合模块拥有实际保存和物理协调。
- 船体场景拥有共用坐标、装备展示、媒体、引擎着色成品引用和导航。

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

- 联合问题必须按实际文件及 CSV 行键匹配来源记录，定位复用所属统计浮层及字段登记；字段位置与文件共同展示，已有控件按当前目标展开并聚焦。
- 装配问题定位必须消费已有模块选择和武器组对话框，字段目标随所属对话框打开状态交付；文件位置及解析行列消费窗口既有文件动作。
- 引用切换必须说明原引用、新引用及待保存路径；多项身份跟随共同展开实际对象和路径，确认保留所属草稿、原文与历史。
- Core 修改必须通过明确来源选择与覆盖确认，缺失记录消费正式构造器和授权目标；缺失字段由显式字段提交建立。
- `FieldInputs` 必须登记手填引用与临时调整；保存等待异步 finalizer 并消费接纳结果，取消或错误阻断当前保存并保留所属原文。
- `JointEditRoot` 必须完整表达 `sessionId`、`modRoot`、kind 与 id；战机联队行身份由 CSV `rowKey` 解析，身份接纳共同映射窗口、草稿、输入和历史。
- 共享字段组件只允许提交所属来源记录；多字段浮层必须在全部原文有效后一次交付字段集合，并登记一条联合历史。
- 共同运行态必须唯一拥有联合会话与历史，业务实现消费原引用。
- 内容渲染器必须显式消费只读或编辑模式；编辑模式由所属会话提供字段能力，只读模式只允许消费投影、来源与媒体结果。
- 武器槽位必须向唯一槽位 renderer 交付船体缩放、即时选中高亮和内置身份；普通轮廓按闲置 0.66 与高亮 1 的比例缩放，内置轮廓保持 0.66，射界与朝向线消费既有屏幕样式，中心标记半径固定为零。
- 多来源浮层必须逐字段判定编辑权限，原版字段独立保留只读展示；空白皮肤字段提交移除以恢复继承，查看及提交未改动输入保持来源内容。
- 字段身份必须使用稳定来源角色与路径；单行输入以 Enter 提交、Esc 取消，多行描述以 Ctrl+Enter 提交，未完成输入参与 dirty、保存和关闭交接。
- 对话层必须拥有所属点击和焦点边界，字段与类别浮层挂载在所属 dialog；返回交接活动字段、取消手填输入并恢复发起入口焦点。
- 引擎必须消费共享装配静止成品与资源运行态，主舰和递归模块共同应用所属坐标变换及有效船体 hint 决定的层序。
- 引用切换必须提交输入、等待保存与同步并确认当前相关草稿；提交后权威重读来源、版本与资源，取消或提交失败保留原引用和草稿。
- 沉浸式基础统计必须明确插件零效果口径；派生项提供公式和来源，编辑动作提交实际来源参数。
- 稳定详情身份必须保持渲染实例；候选在可视区及上下各一个视口的提前量内按需挂载并在选择器内持续驻留，读取消费现有缓存与 single-flight，选择器关闭和身份替换释放所属实例、票据与媒体等待。
- 系统引用必须消费正式来源选项，说明读取所属 `SHIP_SYSTEM` 静态描述；关联武装和插件消费有效来源投影。
- 联合基线必须只经所属保存事件消费过程接纳或读取；关联展示由正式基线及草稿引用驱动，候选与目录保留独立消费职责。
- 资源必须消费后端授权 `ResourceRef` 和所属媒体集合；场景、图标与槽位命中共用正式坐标、层序和有效 Skin 来源，解码接纳服从当前生命周期。
- 静态武器与船体缩略图必须向资源运行态交付成品需求，绘制消费所属正式 renderer；交互场景按实际需求持有原图。
- 武器槽悬停说明必须立即交付中文名称、基础 OP 或内置及空槽状态，主体采用原版浅灰，成本数字与状态词采用原版金黄，模块采用实际名称；文字按原版字号、描边、阴影及随船体缩放的下方居中位置呈现。
