# 弹体编辑器

## 定义

弹体编辑器模块提供弹体及导弹规格的结构化编辑与保存交接。

## 参考

`schemas/spec-defaults.json`：弹体与导弹分支默认模板。
`src-tauri/src/domain/editor_config_definitions.rs`：弹体实体种类、规格目录和默认路径定义。
`src-tauri/src/services/project/definitions/entity_resources.rs`：弹体 sprite 与 bulletSprite 的资源映射。
`src-tauri/src/services/project/definitions/projectiles.rs`：Mod 弹体及 Core 回退的正式读取。
`src-tauri/src/services/project/write/entity_identity.rs`：弹体实际目标和身份保存事务。
`src/app/components/editors/ProjectileEditor.vue`：弹体画布、检查器与事件绑定。
`src/app/composables/editors/use-projectile-editor-view-model.ts`：弹体工作文档、视口、静态绘制装配、分支展示与字段动作 owner。
`src/app/renderers/editors/projectile-scene.ts`：弹体静态场景与最终绘制样式。
`src/domain/editors/lib/projectile-fields.ts`：弹体创建、归一化、分支转换与引擎槽位规则。
`src/domain/editors/projectile-geometry.ts`：规格尺寸、中心、碰撞范围及引擎几何投影。
`src/services/projectile-editor.service.ts`：弹体编辑数据与草稿图像的独立查询。
`src/windows/editor.window.ts`：弹体动作消费的 managed 规格窗口入口。

## 边界

- ProjectSession 拥有弹体实体、Mod 优先读取与 Core 回退，查询交付正式目标及版本。
- 弹体 ViewModel 拥有文档装配、视口、静态绘制、折叠状态、字段和贴图引用选择动作。
- 弹体场景拥有外观和标记，草稿图像运行态拥有授权查询接纳，共享图像运行态拥有解码及释放。
- 弹体领域拥有创建、分支转换、归一化和完整引擎默认值，编号分配消费共享纯原语。
- 武器引用与选项目录归武器模块，开火预览拥有完整弹体读取及模拟。
- 统一提交管线拥有历史、项目投影与失效，消费窗口分别接纳所属依赖。
- 规格窗口会话拥有 dirty、保存、外部基线、身份交接和关闭。

## 链路

### 打开与编辑

1. 武器动作提交输入并捕获弹体 ID，交付所属 session 与 Mod 根。
2. managed 窗口入口创建或复用 projectile 规格窗口。
3. 弹体查询交付单份规格、实际目标、版本和创建状态。
4. 窗口会话接纳规格，弹体 ViewModel 装配 projectile 或 missile 表单。
5. 字段与引擎动作经编辑文档发布所属工作值。

### 静态检查

1. 窗口宿主按当前草稿和基线读取授权弹体图像，交付读取状态与诊断。
2. 弹体领域投影当前尺寸、中心、碰撞范围和引擎，图像运行态交付当前贴图。
3. 属性、资源、主题、尺寸及导航触发静态场景重绘。
4. 初次挂载与重置视图按当前几何适配，后续接纳保留视口。

### 保存与更新

1. 保存动作提交活动输入并捕获独立规格快照。
2. 窗口会话完成身份准备，正式事务返回实际内容和完整 receipt。
3. 统一管线接纳历史、项目投影与身份，发布所属实体和目录失效。
4. 弹体窗口交接基线，武器目录和开火预览分别重新读取。

### 外部接纳与释放

1. 外部读取和保存事件进入所属规格窗口会话。
2. dirty 外部内容暂存，明确载入交接活动输入和规格基线。
3. 弹体文档消费 EditContext 接纳当前规格，折叠状态归当前组件实例。
4. 窗口释放会话、输入、读取与异步资源选择接纳权。

## 规范

- JSON 和颜色输入必须消费现有形状化输入及动作协议，完整规格必须由弹体归一化入口接纳。
- missile 的 engineSpec 必须完整表达 turnAcc、turnRate、acc 与 dec。
- 保存必须消费当前实际目标；同 ID 保存必须保留实际路径，Core 来源必须在当前 Mod 的默认路径创建覆盖。
- 保存期间继续编辑必须保留后续草稿和活动输入，外部内容必须经所属会话接纳。
- 引擎新增必须提供唯一 ID、loc、角度、宽高及完整 CUSTOM styleSpec；引擎槽位只允许在 missile 分支编辑。
- 弹体保存和历史回放必须消费统一提交及失效管线，关联目录和预览只允许由各自 owner 重读。
- 弹体和导弹创建必须消费共享模板的独立克隆；分支转换必须保留业务字段并补齐缺失必读字段。
- 弹体引用必须按 projectileSpecId 交接，严禁依据显示名或选项下标关联。
- 弹体改名必须消费正式身份事务并交接原生窗口、标题及可重载上下文。
- 弹体编辑数据必须以单份规格值表达，目标和版本必须由正式实体查询提供。
- 视口必须归窗口运行态；缩放、平移与重置只允许修改展示状态，规格修改必须经字段动作交接。
- 贴图选择必须捕获编辑上下文并提交授权相对路径，迟到结果严禁接管新基线。

## 陷阱

- 依据 Core 读取路径构造写入目标会破坏 Mod 覆盖归属。
- 把分支切换作为全对象替换会丢失未知业务字段。
- 把选项目录并入弹体草稿会混合查询状态与保存内容。
