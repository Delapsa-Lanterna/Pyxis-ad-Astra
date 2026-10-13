# 武器与弹体编辑器

## 定义

武器与弹体编辑器模块提供武器与弹体规格编辑及保存。

## 参考

`schemas/spec-defaults.json`：前后端共享的 5 类格式、7 个分支默认模板。
`scripts/architecture/rules/editor-module-boundary.mjs`：编辑器组件边界规则 owner。
`src-tauri/src/services/project/query/entities.rs`：草稿武器资源引用 query owner。
`src-tauri/src/services/project/write/entity_description.rs`：消费武器身份的 `WEAPON` 描述同事务更新入口。
`src-tauri/src/services/project/write/entity_identity.rs`：武器、弹体及其关联记录的身份保存 owner。
`src/app/components/editors/ProjectileEditor.vue`：弹体表单与事件绑定入口。
`src/app/components/editors/WeaponEditor.vue`：武器控件、画布事件与弹体入口的绑定组件。
`src/app/composables/editors/use-editor-window-view-model.ts`：消费共享窗口 ViewModel 的目标 Draft Session、弹体 bundle 与资源。
`src/app/composables/editors/use-projectile-editor-view-model.ts`：弹体草稿、分支投影与字段动作 owner。
`src/app/composables/editors/use-weapon-editor-view-model.ts`：武器草稿、挂载视图、发射点与字段动作 owner。
`src/app/renderers/editors/weapon-scene.ts`：武器编辑场景视觉规则与绘制入口。
`src/domain/editors/lib/game-spec-enums.ts`：游戏 spec 正式枚举 owner。
`src/domain/editors/lib/projectile-fields.ts`：弹体引擎槽完整默认值 owner。
`src/domain/editors/lib/weapon-sprite-fields.ts`：武器贴图字段、键映射与 origin 比例 owner。
`src/domain/editors/spec-construction.ts`：规格创建、分支必读字段补入与武器类型选项 owner。
`src/domain/editors/weapon-editing.ts`：发射点操作解析、上下镜像及候选预览的 owner。
`src/domain/editors/weapon-images.ts`：编辑器及沉浸式展示共同消费的静态贴图、绘制阶段与已装载导弹纯投影 owner。
`src/domain/editors/weapon-render-order.ts`：武器顺序、位置修正、隐藏导弹提示与槽位 ID 比较 owner。
`src/services/weapon-data.service.ts`：武器编辑器与开火预览共同消费的规格、CSV、弹体及授权贴图查询 owner。
`src/windows/editor.window.ts`：武器与弹体消费的共享窗口请求入口。

## 边界

- ProjectileEditor 与 WeaponEditor 绑定控件和事件，编辑 ViewModel 装配文档工作值、展示投影与显式动作。
- 共享窗口 ViewModel 拥有 bundle、资源和伴随读取，后端身份事务拥有正式关联保存。
- 发射点与镜像几何归领域规则；场景拥有视觉规则与图层顺序，武器贴图绘制消费领域 origin 与层序投影。
- 弹体保存通过统一失效更新武器依赖，资源交接经正式 query 和缓存。
- 武器编辑 ViewModel 拥有窗口光效预览开关，编辑文档拥有 `glowColor` 草稿与字段动作。
- 武器领域拥有静态装备投影与排序，舰船、武器和沉浸式展示分别消费共享规则。
- 草稿提交与独立预览快照交付归武器编辑动作，开火预览窗口消费所属来源。
- 贴图与帧循环归共享渲染运行态，武器编辑场景消费当前资源。

## 链路

### 武器编辑

1. 窗口按 `.wpn` 目标打开并加载 bundle、弹体与资源。
2. 控件事件进入武器编辑 ViewModel，基础属性、贴图与音效经显式动作提交进草稿。
3. 画布交接指针手势，编辑文档登记动作边界，领域操作执行发射点拖动、Shift 新增、Ctrl 设角度与退格删除。
4. 空格开关镜像，成对生效；U/H 切换炮塔与固定视图。
5. 保存经编辑器写链路完成 changeset、历史与刷新。

### 武器场景绘制

1. 武器编辑 ViewModel 装配草稿、视口、选择、光效预览开关与当前可用贴图。
2. 武器场景计算最终标记样式，调用共享武器贴图绘制与画布原语。
3. 武器编辑 ViewModel 按光效预览开关、当前视图资源与颜色 alpha 调用渲染运行态的帧循环入口。
4. 窗口释放贴图加载回调、着色缓存与帧循环。

### 弹体编辑

1. 武器编辑器按 `projectileSpecId` 打开弹体窗口。
2. 弹体编辑 ViewModel 按 projectile 与 missile 分支投影表单，并提交字段与引擎动作。
3. 保存走弹体事务并接纳完整 receipt，统一提交事件携带实际会话投影。
4. 武器窗口接收弹体失效并刷新引用数据。

### 预览快照交付

1. 预览动作提交活动颜色与 JSON 输入并结束当前编辑动作。
2. 编辑 ViewModel 克隆当前规格并交付独立草稿快照。
3. 窗口内容以 weapon-fire-preview 身份和 draft 来源调用所属窗口请求入口。
4. 接收方完成请求接纳，发起动作消费交付结果并呈现所属错误。

## 规范

- Ship 与 Weapon 的草稿贴图必须经统一 `query_editor_draft_resources` 返回 `ResourceRef`，再经资源缓存加载；接纳结果必须核对目标和草稿资源代次。
- missile 分支必须完整表达 `engineSpec` 的 `turnAcc`、`turnRate`、acc 与 dec；beam 新建必须提供正式 `textureType`。
- `specClass` 条件区段替换必须先提交所属活动输入；颜色与 JSON 原文必须共同参与保存、关闭与外部版本保护。
- 伴随保存事件必须按实体身份与提交序号接纳；较早读取和事件严禁覆盖已接纳的新内容。
- 伴随弹体必须以当前草稿 `projectileSpecId` 查询；弹体内容、选项目录与贴图必须分别持有响应接纳顺序，结果只允许更新所属投影。
- 初次加载、实体刷新、导入和外部版本载入必须以接纳后的当前草稿解析资源；`ResourceRef` 与媒体必须作为同一查询结果接入。
- 发射点坐标必须使用吸附步长；角度偏移必须整数化。
- 同 ID 保存必须保留实际文件路径，ID 修改必须保留原目录并完成正式窗口身份交接。
- 实体刷新、资源失效与窗口释放必须使较早资源结果失效；草稿资源接入必须共同核对目标、资源字段和请求代次。
- 弹体引擎新增必须产生唯一 id、loc、角度、宽高与完整 CUSTOM `styleSpec`；弹体和导弹选项必须来自游戏正式枚举。
- 弹体引用变更必须经 `projectileSpecId` 正式字段，严禁按显示名或下标关联。
- 弹体编辑的引擎槽位只允许在 missile 分支编辑。
- 武器 ID 改名必须共同更新规格、关联 CSV 与 ID/type=`WEAPON` 描述；CSV 关联、规格、文本及联合保存必须消费同一身份规则。
- 武器与弹体必须分别持有实际编辑目标；Core 弹体首次保存必须在当前 Mod 的领域默认路径创建覆盖。
- 武器与弹体的 JSON 输入必须共用形状化输入控件，对象字段必须声明对象形状，完整弹体规格必须由弹体归一化入口处理。
- 武器与弹体的新建必须消费共享模板的独立克隆；引用字段必须由用户继续编辑。
- 武器创建与结构化保存只允许 projectile 和 beam；pulse 原文必须保持可读并允许修正，违规保存必须返回 spec.weapon_class_unsupported 并标明 `specClass`。
- 武器沉浸式窗口必须声明所属武器 CSV、实际规格与 `WEAPON` 描述的联合编辑范围；弹体内容必须经所属独立编辑器保存并触发关联重读。
- 武器类型入口必须备注：pulse 在原版中无法正常处理，武器类型只允许 projectile 和 beam。
- 草稿资源引用必须由后端 query 返回，只允许通过正式资源缓存解析。
- 规格分支切换必须先交接活动输入，再保留已有业务内容并补入目标分支缺失必读字段；一次切换必须登记为一次编辑动作。
- 贴图浏览只允许选择 Mod 根内 PNG，并原样提交授权相对路径；操作只允许更新规格引用。
- 贴图路径变化或资源重新查询必须清空旧媒体投影；查询失败必须经 `AppFeedback` 呈现，资源或实体刷新必须支持重新查询当前草稿。
- 镜像模式必须按当前视图的发射点数组运行，配对必须由坐标对称实时计算，镜像联动只允许作用于画布几何动作。
- 预览动作必须先提交活动输入并结束当前动作，再克隆规格；交付快照必须与编辑器后续草稿独立。

## 陷阱

- 两大视图的发射点数组互相配对会让炮塔与固定坐标互相污染。
- 弹体保存后不刷新武器 bundle 会让引用数据停留在旧值。
- 贴图浏览复制文件或改写路径会破坏纯引用边界。
