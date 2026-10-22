# 资源与原版回退

## 定义

资源与原版回退模块解析授权资源引用，并为界面提供 Mod 与 Core 媒体。

## 参考

### 拥有

- `src-tauri/src/commands/hull_reference.rs`：Hull command。
- `src-tauri/src/commands/resources.rs`：批量资源与引用 command。
- `src-tauri/src/services/project/cache/media.rs`：资源指纹与后端媒体缓存。
- `src-tauri/src/services/project/definitions/entity_resources.rs`：解析实体贴图、光束枚举或自定义贴图对、弹体与等离子默认特效的授权资源。
- `src-tauri/src/services/project/query/hull_references.rs`：舰体引用、槽位及来源选择查询。
- `src-tauri/src/services/project/query/resources.rs`：草稿资源引用与授权资源批量 data URL 查询。
- `src-tauri/src/services/project/resources/mod.rs`：资源实现模块登记及内部引用能力。
- `src-tauri/src/services/project/resources/refs.rs`：媒体资源身份键、业务引用构造和舰体引用解析。
- `src-tauri/src/services/project/resources/sprites.rs`：批次来源边界、媒体读取、缓存接纳和相对路径解析。
- `src/app/components/media/`：授权图片与配置选项消费的缩略图展示。
- `src/app/composables/editors/use-resource-reference.ts`：贴图引用选择。
- `src/app/composables/use-resource-images.ts`：场景与图片展示的解码引用和迟到接纳。
- `src/app/composables/use-resource-media-registry.ts`：持有集合差量、业务引用、媒体租约与所属反馈。
- `src/app/composables/use-resource-thumbnail.ts`：交付普通缩略图需求与静态成品展示生命周期。
- `src/app/composables/use-schema-select-media.ts`：当前选项图片、超额结果及菜单释放。
- `src/app/composables/use-thumbnail-preload.ts`：可见优先与邻近预读队列的资源集合消费。
- `src/app/composables/use-visible-resource-media.ts`：可视区媒体解析。
- `src/app/composables/use-window-image-runtime.ts`：窗口图片、成品、代次、引用与预读并发。
- `src/domain/resources/hull-references.ts`：选项及内置槽位的纯投影。
- `src/services/engine-assets.service.ts`：通过正式资源查询交付合并引擎样式、来源版本及授权图片引用。
- `src/services/hull-reference.service.ts`：Hull 查询及引用投影。
- `src/services/resource-media-query.spec.ts`：验证完整批次、物理共享、失效和一次性查询。
- `src/services/resource-media.service.ts`：唯一持有媒体读取、合批、租约、响应式结果、闲置预算和失效。
- `src/services/resource-media.spec.ts`：媒体引用、展示集合与释放行为验证。
- `src/services/resource-reference.service.ts`：草稿资源查询与授权相对引用解析能力。

### 消费

- `src-tauri/src/models/project_identity.rs`：资源来源与所属身份。
- `src-tauri/src/models/resources.rs`：草稿资源、批量图片、路径及舰体引用请求与结果。
- `src-tauri/src/services/project/model.rs`：资源读取消费的已加载来源记录。
- `src-tauri/src/services/project/resources/fonts.rs`：session 来源补充、安装根授权及 FNT 图集读取。
- `src-tauri/src/services/project/sources/core.rs`：实际来源根所属的共享 Core 文档目录。
- `src/domain/schema/schema-options.ts`：资源展示消费的只读选项交接，类型与纯投影归字段模式领域。
- `src/shared/lib/resource-ref.ts`：资源身份键、相等与集合纯规则。
- `src/shared/runtime/app-log-queue.ts`：媒体请求、解码、成品接纳和释放的详细记录。
- `src/shared/runtime/cache.ts`：资源缓存消费的 LRU 及 `pending` 原语。
- `src/shared/runtime/resident-cache.ts`：活跃与闲置分离的预算缓存原语。
- `src/shared/types/resources.types.ts`：草稿资源、批量图片、路径及舰体引用请求与结果。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。

## 边界

- Core 文档目录由来源读取按 canonical 游戏根交付，引用能力消费所属只读成果。
- 可视区与选项媒体 owner 登记实际展示集合，资源替换和释放交还所属等待。
- 各 WebView 由唯一媒体 owner 持有 data URL；窗口图片运行态分别持有解码和成品，活跃引用与闲置预算分别计量。
- 后端拥有资源授权、Mod 优先与 Core 回退；query 返回 `ResourceRef`，组件消费引用和媒体结果；字体 FNT 与图集按原版字体只读能力交给所属字体运行态。
- 媒体服务拥有合批、single-flight、就绪数据与失效；registry 持有集合差量和所属租约。
- 舰体引用能力分别提供创建目录和指定 ID 元数据，名称按 Mod CSV 优先、Core 补集解析。
- 舰船内置展示消费共享媒体集合，几何调整复用当前解码结果，资源失败按所属槽位、武器引用和路径交付诊断。
- 贴图选择归引用能力，返回后端校验的 Mod 根内正斜杠相对路径。

## 链路

### 资源解析

1. 组件或 schema 选项携带 `ResourceRef` 请求资源。
2. 媒体服务直接交付就绪结果、共享在途结果，并对集合冷请求采用 25ms 合批；一次性查询立即交接所属排队任务。
3. 后端批次按媒体资源键复用本次结果与缓存，按实际访问准备 Mod/Core 根边界并逐文件授权读取。
4. 返回 data URL 进入前端 LRU 缓存并驱动渲染。

### 草稿资源查询

1. 所属编辑器交付捕获的 session、种类、ID 与正式草稿。
2. resource-reference 通过实时请求捕获参数，调用 query_draft_resources。
3. 后端核对所属会话就绪状态，按业务字段映射资源引用。
4. 图像消费者通过正式媒体与图像运行态读取、接纳及释放结果。

### 贴图引用选择

1. 用户在编辑器发起贴图浏览。
2. 文件选择限定 Mod 根内 png；Mod 外拒绝。
3. 后端校验绝对路径归属并返回正斜杠相对路径。
4. 相对路径原样写入引用字段，不复制、不改名。

### 舰体引用解析

1. 编辑器按需请求舰体引用目录或带 ID 元数据。
2. 空请求返回创建表单目录；带 ID 请求解析名称与引用。
3. 名称按当前 Mod `ship_data.csv` 优先、原版补集解析。

### 核心派生索引

1. 首次访问某 Core 类型时扫描并接纳内存索引，登记所属缓存的持久化请求。
2. 来源读取按当前内容版本校验并复用匹配解析成果。
3. 项目打开完成或缓存失效前集中写入来源成果，释放后由新句柄承载后续目录。

## 规范

- Core root 与所有资源路径必须 canonicalize，拒绝 `..` 与已有父链链接或 reparse point。
- Core 缓存注册表、条目、加载与完整失效必须由 Core 缓存实现维护；注册表锁只允许用于登记、查找、移除与句柄复制，磁盘读取必须在释放注册表锁后执行。
- Hull 请求身份必须使用去重排序后的 ID 集合，名称、选项与槽位必须消费所属领域纯投影。
- Skin 实体贴图必须消费 SkinFile.data.spriteName；内置槽位必须携带最后定义该内置武器的 Mod/Core 来源并据此分组。
- 列表缩略图只允许解析 observer 预读区内的资源。
- 前端严禁构造 `ResourceRef`、拼路径、逐项读图或把 data URL 写入 manifest；缺失 data URL 保持 `null`。
- 单个 data URL 超过闲置预算时必须保留活跃租约，最后一个引用释放时必须立即逐出；隐藏、引用切换、失效和卸载必须交还所属工作引用。
- 原版来源刷新必须按实际来源目录失效所属索引，已有无关索引必须继续由原缓存拥有。
- 发射特效路径必须由正式资源解析交付，武器、弹体及特效角色必须保留完整资源身份并共享物理媒体。
- 可见元素 ref 再次登记同一 DOM 时必须保持可见身份和当前资源结果。
- 可见媒体 owner 必须按资源登记、可见性变化、引用替换和卸载增量释放；登记单行严禁扫描全部登记项。
- 各缓存消费正式 settings 预算，保存成功及镜像接纳后立即缩容或扩容；闲置结果同时受条数及字节限制并按 LRU 逐出，活跃工作集保持引用；合批消费共享 single-flight 与所属失效。
- 媒体批次必须捕获就绪 session 的来源根，按来源与规范化路径复用本次结果，结束后必须释放批次状态；跨查询保留必须归媒体缓存。
- 媒体批次的失败资源必须按物理资源键建立一次结果索引，再按键交付可见消费者；错误后的下一次活跃集合请求必须释放已失败票据并重试。
- 媒体根边界必须按实际访问在批次内准备并复用，每次实际读取必须复核根目录状态，目标必须逐次消费正式路径与已有父链授权。
- 媒体消费者必须分别登记场景、列表、详情及控件集合；可见图片必须优先读取，邻近预读必须在可见解码后消费窗口队列；引用替换、模块切换和关闭必须释放所属引用与等待。
- 媒体缓存命中必须先于根边界准备，全部命中时根准备次数必须为零；关闭 session 后的迟到结果严禁写入媒体缓存。
- 媒体读取必须优先交付实际 Mod 文件，回退或显式读取 Core 时必须校验所属 Core 根；来源目录变化必须在实际访问时核对。
- 引擎图片必须按每个槽位的有效样式选择，严禁采用原版首槽位决定整舰贴图的行为；此项必须作为编辑器与原版的行为差异说明。
- 引擎样式必须按 Core、Mod 顺序递归合并对象，颜色数组及叶值必须由后来源替换；默认与逐槽位自定义图片必须独立按 Mod 优先与 Core 回退解析。
- 引擎资源查询必须通过 session 就绪门控共享在途读取，来源刷新、会话关闭及迟到结果必须消费所属读取票据与失效。
- 引用解析只接受 Mod 根内安全相对路径；绝对路径、`..` 与链接逃逸必须拒绝。
- 成品引用交接必须先取得新引用再释放旧引用，同一资源失效必须按物理身份去重并只递增一次修订。
- 指纹不一致即丢弃快照并重建；缓存损坏或不可写只降级，严禁读取旧快照。
- 整批返回必须先核对数量、顺序、完整资源身份与 nullable data URL，再发布所属缓存。
- 缺失资源的 null 结果必须与正结果共同服从闲置条数预算，资源失效或预算逐出后必须重新核对；读取异常严禁进入结果缓存，下次明确活跃请求必须重试。
- 联合配置资源必须消费 Core／Mod 的实际配置和版本，UI 图标必须从 graphics.ui 解析；展示消费者必须使用返回的 `ResourceRef`。
- 草稿资源查询必须由资源能力交付，必须捕获当前正式草稿并消费实时请求及所属 session 的接纳与释放。
- 表记录图片必须消费正式 sprite 引用，缺失图片的默认资源必须由后端按格式规则解析并授权。
- 规格纹理数组引用必须携带完整字段路径；失效必须依据实际授权引用接纳，引擎样式选项必须复用合并后的正式目录。
- 资源共享读取必须归媒体 owner，集合租约必须归所属 registry；释放只允许结束所属等待，迟到结果严禁写入已撤销生命周期。
- 选项媒体 owner 必须分别登记菜单、已选值、摘要和键值行集合；集合替换必须只更新受影响资源，引用计数归零时必须交还租约。
- 静态武器及装配绘制必须共用正式层序、原点、发射点与有效 Skin 来源，已装载导弹必须消费实际弹体资源。
- 静态缩略图与预读必须共用成品需求和在途任务，原图工作引用必须在绘制完成后释放；返回可见区必须复用当前签名的完成画面。
- 预读只允许请求所属视口上下各一个视口的邻近资源，窗口预读只允许四项并发；失效、session 关闭和窗口销毁必须清理所属解码及依赖成品，迟到值必须服从所属票据。
- 驻留图片与成品必须提供同步就绪消费；成品身份必须包含 session、来源代次、实际绘制参数、尺寸和 DPR，成品只允许消费正式领域绘制。

## 陷阱

- Core fallback 允许写盘会让只读边界被突破。
- 同一物理数据的预算只登记一次，活跃租约与闲置保留分别计量。
- 在前端按路径规则拼出 `ResourceRef` 会让资源身份脱离后端授权。
- 指纹校验跳过会让过期派生索引冒充当前 Core 内容。
- 缓存命中不刷新访问顺序会让 LRU 逐出策略失真。
- 逐项 IPC 读图会让列表滚动产生请求风暴。
