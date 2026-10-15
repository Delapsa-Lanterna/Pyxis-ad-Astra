# 画布编辑器骨架

## 定义

画布编辑器骨架模块为实体编辑提供共享交互、动作提交与渲染基础设施。

## 参考

`schemas/spec-defaults.json`：规格创建与分支转换消费的共享默认模板资产。
`src/app/composables/canvas/use-canvas-editor.ts`：指针阶段、输入适配、导航、快捷键与窗口监听的 owner。
`src/app/composables/canvas/use-canvas-navigation.ts`：骨架和装配消费的右键平移、滚轮缩放与指针位置 owner。
`src/app/composables/canvas/use-canvas-palette.ts`：主题派生与重绘通知的装配 owner。
`src/app/composables/canvas/use-canvas-selection.ts`：骨架和装配消费的距离命中、选区身份与显式选择 owner。
`src/app/composables/canvas/use-canvas-state.ts`：完整目标身份、悬停、检查器锁定、镜像开关与候选预览的 owner。
`src/app/composables/canvas/use-canvas-viewport.ts`：视口缩放与平移 owner。
`src/app/composables/editors/use-editor-document.ts`：工作值、动作起点、提交快照、字段与手势边界及历史交接的 owner。
`src/app/composables/editors/use-editor-fields.ts`：所属文档字段、颜色与对象输入的绑定入口。
`src/app/composables/editors/use-editor-frame-loop.ts`：帧循环的启动、停止与释放 owner。
`src/app/composables/editors/use-editor-images.ts`：贴图加载、替换、结果接纳、解码修订、着色缓存与释放 owner。
`src/app/composables/spec-editor/use-spec-editor-draft-images.ts`：草稿图像读取票据、状态诊断、资源失效及投影接纳的共享运行态。
`src/app/composables/use-snapshot-history.ts`：编辑文档消费的目标快照历史适配器。
`src/app/renderers/editors/canvas-drawing.ts`：清屏、网格与像素贴图的无状态绘制入口。
`src/app/renderers/editors/canvas-scene.ts`：共享背景、镜像轴、边界与光标场景的绘制入口。
`src/app/renderers/editors/canvas-styles.ts`：场景消费的标记样式投影入口。
`src/app/renderers/editors/canvas-visuals.ts`：消费显式样式的实体绘制原语。
`src/app/renderers/editors/weapon-images.ts`：武器编辑、发射预览、舰船与装配消费的共享贴图、装备阶段及光效绘制入口。
`src/domain/editors/editor-types.ts`：编辑坐标、模式与悬停预览的纯数据类型 owner。
`src/domain/editors/lib/canvas-palette.ts`：应用主题到画布配色的纯投影 owner。
`src/domain/editors/lib/editor-constants.ts`：吸附步长与选项常量 owner。
`src/domain/editors/lib/game-spec-enums.ts`：规格字段消费的游戏枚举常量。
`src/domain/editors/lib/mirror.ts`：镜像规则 owner，拥有对称判定、镜像角度与成对新增。
`src/domain/editors/spec-construction.ts`：共享规格创建与必读字段补齐的纯规则入口。
`src/shared/lib/entry-keys.ts`：稳定条目键 owner，为列表渲染提供结构化稳定 key。
`src/shared/lib/next-formatted-id.ts`：舰船及弹体消费的编号分配纯原语。

## 边界

- `EditContext` 绑定动作、历史和目标，本地保存及外部载入由会话交接。
- 共享导航拥有平移、缩放和指针位置，共享选区原语拥有命中与选择；骨架和装配分别消费。
- 历史原语持有独立前后快照，编辑文档管理字段、命令与手势的动作边界。
- 图像解码失败回调由展示消费方提供；资源替换与释放清除成功、失败回调及当前加载身份。
- 检查器拥有字段输入，提交回调把动作交付业务草稿。
- 渲染场景拥有视觉规则，绘制原语消费明确的几何与最终样式。
- 编辑 ViewModel 装配文档、领域操作、选区、视口与场景；组件消费分组展示与动作接口。
- 草稿图像运行态拥有授权资源查询及结果接纳，渲染运行态拥有解码、着色缓存与帧循环，编辑 ViewModel 装配场景输入。
- 骨架拥有闲置、输入等待与编辑手势阶段；选区状态归共享状态原语，草稿与历史归编辑文档。
- 骨架装配 resize、keydown 与 keyup，组件释放所属交互与监听。

## 链路

### 指针按下

1. 骨架记录指针坐标并区分右键平移与左键动作。
2. 所属活动输入完成提交，编辑文档捕获动作起点。
3. 领域操作解析目标、动作种类与镜像对。
4. 骨架进入所属手势，清空候选预览并应用当前位置。

### 指针移动

1. 骨架更新指针状态并处理右键平移。
2. 编辑手势委托所属领域操作更新工作值。
3. 闲置阶段计算候选预览，并在输入与修饰键允许时交接选区。

### 指针释放与离开

1. 编辑文档结束手势，提交工作值并登记一次历史。
2. 骨架恢复闲置，结束平移并清空候选预览。
3. 重绘画布；离开时额外清空指针在画布内标记。

### 撤销与重做

1. 快捷键分发进入编辑文档的撤销或重做动作。
2. 编辑文档接纳快照，重置所属选区与预览。
3. 工作值交付目标会话并触发重绘。

### 窗口与检查器联动

1. 骨架挂载 resize 并在尺寸变化后重绘。
2. 修饰键按下或释放时重算 hover 预览。
3. 检查器 reveal 按编辑器提供的 section 与选择器展开并滚动定位。

### 场景与渲染运行态

1. 编辑 ViewModel 接纳草稿、视口与选区，消费主题派生和当前可用资源。
2. 指针、字段、主题、资源或动画通知进入重绘回调。
3. 场景计算视觉样式并调用应用渲染层的绘制原语。
4. 窗口释放交互监听、贴图加载回调、着色缓存与帧循环。

## 规范

- draft 必须通过显式动作边界提交，指针拖拽期间必须保留静默草稿，严禁使用深度 watch 同步业务提交。
- 主题变化必须保留草稿、选区、视口与历史；领域语义配色必须由所属领域拥有。
- 修饰键预览必须在指针未进入画布、拖拽中或平移中跳过。
- 共享选区必须由所属状态引用承载；骨架必须保留最近目标消费，装配必须按命中半径消费实际槽位；业务动作必须归各自会话与历史。
- 帧循环必须由所属渲染运行态启动、停止与释放。
- 平移起点、指针位置、释放与缩放必须共同归导航原语；所属组件卸载必须结束平移和 DPI 监听。
- 待提交输入必须保留其选区归属；自动悬停选择只允许在所属输入与字段动作完成后替换目标。
- 拖拽必须在释放、离开或保存捕获时提交当前位置并结束动作；后续指针事件只允许消费新的动作。
- 提交必须经唯一回调进入对应编辑会话，重复提交必须被会话相等语义吸收。
- 数字原文、JSON 和颜色输入必须先完成字段转换；动作终结器必须在全部输入与复合控件提交后登记历史。
- 检查器连续输入必须实时提交草稿，并在单行 Enter、失焦、多行 Ctrl+Enter 或保存时结束一次字段动作。
- 视图切换、检查器选择与显式增删必须消费所属文档动作；撤销重做必须经所属输入提交边界重绘草稿。
- 贴图运行态必须按资源键与内容增量接纳，稳定资源必须复用已解码图像和在途加载；替换与窗口释放必须撤销所属回调并释放对应图像和着色缓存。
- 输入交接期间的短点击必须保留按下、最新位置与释放状态；指针动作必须沿同一上下文完成。
- 选区状态必须以完整目标身份表达，港口必须包含所属槽位与港口下标，命中判定必须按距离与半径排序。
- 骨架内严禁出现实体名称或业务字段。
- 骨架必须通过只读指针投影与重绘回调交接渲染；场景必须消费显式输入并返回 `void`。
- 骨架返回的状态引用必须由编辑器直接消费，严禁复制状态导致双份真相。

## 陷阱

- 在编辑器内重建命中与选区会让两个画布的命中语义漂移。
- 在骨架内写死实体类型会使领域扩展依赖共享交互层的改写。
- 拖拽中逐帧提交 draft 会让父级会话产生大量中间态。
- 挂载第二份窗口事件监听会让修饰键预览互相覆盖。
- 让骨架直接调用保存或历史会让交互层侵入保存链路。
