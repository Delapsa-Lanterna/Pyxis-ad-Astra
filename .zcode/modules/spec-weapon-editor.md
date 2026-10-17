# Spec 武器编辑器

## 定义

武器编辑器模块提供武器规格编辑及其资源、弹体引用和开火预览交接。

## 参考

### 拥有

- `src/app/components/spec-editor/weapon/`：武器画布、检查器与行为测试。
- `src/app/components/spec-editor/weapon/SpecWeaponEditor.vue`：武器控件与画布事件绑定。
- `src/app/composables/spec-editor/weapon/`：武器字段、发射点动作、光效与资源依赖生命周期。
- `src/app/composables/spec-editor/weapon/use-spec-weapon-editor-dependencies.ts`：武器贴图与弹体选项目录的读取接纳。
- `src/app/composables/spec-editor/weapon/use-spec-weapon-editor-view-model.ts`：武器文档、发射点动作、挂载视图与光效预览。
- `src/app/renderers/spec-editor/weapon/`：武器贴图与发射点场景。
- `src/app/renderers/spec-editor/weapon/spec-weapon-scene.ts`：武器场景视觉规则与绘制入口。
- `src/domain/editors/lib/weapon-sprite-fields.ts`：武器贴图字段、键映射及 origin 比例。
- `src/domain/editors/weapon-images.ts`：静态装备贴图、绘制阶段及已装载导弹纯投影。
- `src/domain/editors/weapon-render-order.ts`：装备绘制顺序、位置修正与槽位 ID 比较。
- `src/domain/editors/weapon-spec.ts`：武器创建、归一化、分支转换与正式类型入口。
- `src/domain/spec-editor/weapon/`：发射点动作、镜像及操作预览规则。
- `src/domain/spec-editor/weapon/spec-weapon-editing.ts`：发射点操作、上下镜像及候选预览。
- `src/services/spec-weapon-editor.service.ts`：武器编辑数据、贴图和弹体选项目录的查询入口。
- `src/services/weapon-data.service.ts`：武器规格、CSV 与授权武器资源的共享查询。

### 消费

- `src/windows/spec-editor.window.ts`：四类规格的身份、尺寸与结构化窗口请求。

### 关联

- `src-tauri/src/services/project/write/entity_description.rs`：舰船与武器描述行的身份改名和同根暂存。

## 边界

- 开火预览拥有完整弹体读取、模拟和播放，武器编辑动作交付独立草稿快照。
- 武器依赖运行态拥有贴图与弹体目录，查询和资源缓存拥有正式实体与授权资源。
- 武器场景拥有标记样式和图层，领域规则拥有发射点操作及静态装备投影。
- 武器文档拥有规格工作值和动作，编辑 ViewModel 拥有挂载视图、选区及光效开关。
- 窗口会话拥有目标、版本、dirty、保存与外部基线，武器模块消费正式交接。
- 贴图解码、着色缓存与帧循环归共享渲染运行态。

## 链路

### 编辑与保存

1. 规格窗口定义调用武器编辑查询，窗口会话接纳规格、目标和版本。
2. 武器依赖运行态读取当前草稿贴图及弹体选项目录。
3. 字段与画布动作经武器文档更新规格，领域操作完成发射点及镜像修改。
4. 保存动作经窗口会话完成实际身份事务、历史及统一提交。

### 弹体与预览交接

1. 编辑弹体或预览动作提交活动输入并结束当前动作。
2. 弹体动作捕获当前 projectileSpecId，窗口宿主交付完整规格窗口身份。
3. 预览动作克隆武器规格，窗口宿主交付 draft 来源。
4. 弹体提交使选项目录与预览所属依赖失效，各自运行态重新读取。

### 光效与资源

1. 武器依赖运行态按目标、草稿贴图字段与基线交接接纳资源。
2. 编辑 ViewModel 向场景交付当前资源及光效开关。
3. 当前视图的光效资源和 alpha 决定绘制与帧循环。
4. 窗口释放读取、资源、着色缓存及帧循环。

## 规范

- 光效开关必须归窗口运行态，重新打开窗口必须初始关闭；保存、撤销及外部载入必须保留当前选择。
- 光效必须在开关开启、当前 glow 贴图就绪及 alpha 大于 0 时绘制并运行帧循环。
- 发射点坐标必须消费所属吸附步长，角度偏移必须整数化。
- 弹体打开必须在输入提交后捕获当前引用；预览必须交付与后续编辑独立的草稿快照。
- 普通武器编辑器只允许消费弹体 ID 和选项目录；完整弹体内容必须由所属编辑或预览入口读取。
- 武器创建与结构化保存只允许 projectile 和 beam；pulse 原文必须保持可读，违规保存必须返回 spec.weapon_class_unsupported。
- 武器改名必须消费正式身份事务，共同更新规格、关联 CSV 与 WEAPON 描述。
- 武器规格转换必须先提交活动输入，保留业务字段并补齐目标分支缺失必读字段。
- 武器资源必须按当前草稿经授权 query 读取，结果接纳必须核对目标与读取票据。
- 界面刷新必须由所属根登记实际来源与动作，并沿现有保存等待、草稿和外部更新接纳流程执行。
- 贴图浏览只允许提交 Mod 根内的授权 PNG 相对路径。
- 选项目录与资源必须分别持有读取通道；接纳只允许更新所属展示投影。
- 镜像必须按当前挂载视图运行，位置与角度必须共同消费领域上下镜像规则。

## 陷阱

- 两种挂载视图的发射点互相配对会污染所属几何。
- 依赖查询写入规格工作值会使后台读取接管编辑动作。
- 把窗口光效开关保存进规格会污染游戏业务字段。
