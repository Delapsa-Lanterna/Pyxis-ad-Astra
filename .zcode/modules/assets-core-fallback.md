# 资源与原版回退

## 定义

资源与原版回退模块按有序来源解析授权资源引用，并为界面提供当前 Mod、可引用 Mod 与原版媒体。

## 参考

### 拥有

- `src-tauri/src/commands/hull_reference.rs`：Hull command。
- `src-tauri/src/commands/resources.rs`：批量资源与引用 command。
- `src-tauri/src/services/project/query/hull_references.rs`：船体引用、槽位及来源选择查询。
- `src-tauri/src/services/project/query/resources.rs`：草稿资源引用与授权资源批量 data URL 查询。
- `src-tauri/src/services/project/resources/entity_references.rs`：实体内容、列表图标、特效、继承资源及资源来源投影。
- `src-tauri/src/services/project/resources/hull_references.rs`：按会话与有序来源解析船体名称、贴图和皮肤继承。
- `src-tauri/src/services/project/resources/media_cache.rs`：按 session 隔离媒体指纹、LRU、预算及所属清理。
- `src-tauri/src/services/project/resources/mod.rs`：资源实现模块登记及内部引用能力。
- `src-tauri/src/services/project/resources/resource_identity.rs`：资源引用构造、单项及集合的引用来源接纳与物理媒体键。
- `src-tauri/src/services/project/resources/sprites.rs`：批次来源边界、媒体读取、缓存接纳和相对路径解析。
- `src-tauri/src/services/project/resources/table_references.rs`：表格行、图片路径列及来源引用的授权资源与显示名称投影。
- `src/app/components/media/`：授权图片与配置选项消费的缩略图展示。
- `src/app/composables/editors/use-resource-reference.ts`：贴图引用选择。
- `src/app/composables/use-resource-images.ts`：场景与图片展示的解码引用和迟到接纳。
- `src/app/composables/use-resource-media-registry.ts`：持有集合差量、业务引用、媒体租约与所属反馈。
- `src/app/composables/use-resource-thumbnail.ts`：交付普通缩略图需求与静态成品展示生命周期。
- `src/app/composables/use-thumbnail-preload.ts`：可见优先与邻近预读队列的资源集合消费。
- `src/app/composables/use-visible-resource-media.ts`：可视区媒体解析。
- `src/app/composables/use-window-image-runtime.ts`：窗口图片、成品、代次、引用与预读并发。
- `src/domain/resources/hull-references.ts`：选项及内置槽位的纯投影。
- `src/services/engine-assets.service.ts`：通过正式资源查询交付合并引擎样式、来源版本及授权图片引用。
- `src/services/hull-reference.service.ts`：Hull 查询及引用投影。
- `src/services/resource-media.service.ts`：唯一持有媒体读取、合批、租约、响应式结果、闲置预算和失效。
- `src/services/resource-reference.service.ts`：草稿资源查询与授权相对引用解析能力。

### 消费

- `src-tauri/src/domain/json_composition.rs`：引擎样式的游戏 JSON 合并纯运算。
- `src-tauri/src/models/project_identity.rs`：资源来源与所属身份。
- `src-tauri/src/models/resources.rs`：草稿资源、批量图片、路径及船体引用请求与结果。
- `src-tauri/src/services/project/model.rs`：资源读取消费的已加载来源记录。
- `src-tauri/src/services/project/query/json_layers.rs`：正式有序 JSON 来源层及其版本。
- `src-tauri/src/services/project/resources/fonts.rs`：session 来源补充、安装根授权及 FNT 图集读取。
- `src-tauri/src/services/project/sources/core.rs`：实际来源根所属的共享 Core 文档目录。
- `src/shared/lib/resource-ref.ts`：资源身份键、相等与集合纯规则。
- `src/shared/runtime/app-log-queue.ts`：媒体请求、解码、成品接纳和释放的详细记录。
- `src/shared/runtime/cache.ts`：资源缓存消费的 LRU 及 `pending` 原语。
- `src/shared/runtime/resident-cache.ts`：活跃与闲置分离的预算缓存原语。
- `src/shared/runtime/use-layout-frame.ts`：媒体视口尺寸更新的帧合并及作用域释放。
- `src/shared/types/resources.types.ts`：草稿资源、批量图片、路径及船体引用请求与结果。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。

## 边界

- Core 文档目录由来源读取按 canonical 游戏根交付，引用能力消费所属只读成果。
- 可视区与选项媒体 owner 登记实际展示集合，资源替换和释放交还所属等待。
- 各 WebView 由唯一媒体 owner 持有 data URL；窗口图片运行态分别持有解码和成品，活跃引用与闲置预算分别计量。
- 后端拥有资源授权与当前 Mod、标签顺序内可引用 Mod、原版的查找顺序；query 返回 `ResourceRef`，组件消费引用和媒体结果；字体 FNT 与图集按原版字体只读能力交给所属字体运行态。
- 媒体服务拥有合批、single-flight、就绪数据与失效；registry 持有集合差量和所属租约，目录资源通知按来源身份及路径范围匹配已登记媒体。
- 实体内容由正式会话交付，资源能力分别维护详情与列表资源映射，完整媒体清理由项目同步调用。
- 资源身份能力消费捕获的文件来源或引用身份，为单项及集合接纳所属引用来源。
- 舰船内置展示消费共享媒体集合，几何调整复用当前解码结果，资源失败按所属槽位、武器引用和路径交付诊断。
- 船体引用能力分别提供创建目录和指定 ID 元数据，名称按 Mod CSV 优先、Core 补集解析。
- 船体选项投影消费资源协议的只读字段，实体和表格资源直接消费资源所属船体解析器。
- CSV 图片路径列资源按 Mod 行实际字段值投影，保留行实体 ID 与图标资源身份。
- 贴图选择归引用能力，返回后端校验的 Mod 根内正斜杠相对路径。

## 链路

### 资源解析

1. 组件或 schema 选项携带 `ResourceRef` 请求资源。
2. 媒体服务直接交付就绪结果、共享在途结果，并对集合冷请求采用 25ms 合批；一次性查询立即交接所属排队任务。
3. 后端批次按媒体资源键复用本次结果与缓存，按实际访问准备当前 Mod、可引用 Mod 或原版根边界并逐文件授权读取。
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

### 船体引用解析

1. 编辑器按需请求船体引用目录或带 ID 元数据。
2. 空请求返回创建表单目录；带 ID 请求解析名称与引用。
3. 名称按当前 Mod、标签顺序内可引用 Mod、原版的 `ship_data.csv` 与规格补集解析。

### 核心派生索引

1. 首次访问某 Core 类型时扫描并接纳内存索引，登记所属缓存的持久化请求。
2. 来源读取按当前内容版本校验并复用匹配解析成果。
3. 项目打开完成或缓存失效前集中写入来源成果，释放后由新句柄承载后续目录。

## 规范

- 媒体路径键必须消费公共 Windows 字符映射，来源、所属根和实际资源路径分别保留。
- 批量媒体结果必须按请求顺序保留完整资源身份，成功交付 nullable 图片内容，失败逐项交付原始诊断；同一物理资源复用本批读取结果。
- 媒体消费者必须接纳本批成功项，失败项保留可重试状态；同批错误共享一个错误对象并经所属窗口汇总一次反馈、逐项记录原始诊断。
- 外部 Mod 资源必须携带实际来源会话与根，媒体缓存区分来源身份及引用范围版本，关闭或取消来源后撤销所属读取。
- 引用来源转换必须由资源身份能力维护；Core 资源与已有引用身份保留，普通 Mod 资源接纳捕获的引用身份，资源路径、业务 owner 与字段键保留。
- Core fallback 只允许提供只读资源。
- Core root 与所有资源路径必须 canonicalize，拒绝 `..` 与已有父链链接或 reparse point。
- Skin 实体贴图必须消费 SkinFile.data.spriteName；内置槽位携带最后定义该内置武器的 Mod/Core 来源并据此分组。
- 资源读取必须绑定请求 session；`ResourceRef` 由后端授权并交付 source 与规范化 relPath，外部 Mod 引用携带实际来源 session 与根；前端严禁构造引用、拼路径、逐项读图或把 data URL 写入 manifest，缺失 data URL 保持 `null`。
- 单个 data URL 超过闲置预算时必须保留活跃租约，最后一个引用释放时立即逐出；隐藏、引用切换、失效和卸载交还所属工作引用。
- 可见媒体 owner 必须按资源登记、可见性变化、引用替换和卸载增量释放；登记单行严禁扫描全部登记项。
- 各缓存消费正式 settings 预算，保存成功及镜像接纳后立即缩容或扩容；闲置结果同时受条数及字节限制并按 LRU 逐出，活跃工作集保持引用；合批消费共享 single-flight 与所属失效。
- 同一物理数据的预算只允许登记一次，活跃租约与闲置保留必须分别计量。
- 媒体批次必须捕获就绪 session 的来源根，按来源与规范化路径复用本次结果，结束后释放批次状态；跨查询保留归媒体缓存。
- 媒体批次的失败资源必须按物理资源键建立一次结果索引，再按键交付可见消费者；错误后的下一次活跃集合请求释放已失败票据并重试。
- 媒体根边界必须按实际访问在批次内准备并复用，每次实际读取复核根目录状态，目标逐次消费正式路径与已有父链授权。
- 媒体缓存命中必须先于根边界准备，全部命中时根准备次数为零；关闭 session 后的迟到结果严禁写入媒体缓存。
- 引擎图片必须按每个槽位的有效样式选择，严禁采用原版首槽位决定整舰贴图的行为；此项作为编辑器与原版的行为差异说明。
- 引擎样式必须消费原版、前序可引用 Mod、当前 Mod 的游戏 JSON 合并结果；默认与逐槽位自定义图片按实际资源来源解析。
- 引用解析只接受 Mod 根内安全相对路径；绝对路径、`..` 与链接逃逸必须拒绝。
- 成品引用交接必须先取得新引用再释放旧引用，同一资源失效必须按物理身份去重并只递增一次修订；目录通知必须匹配实际登记或持有的资源，所属后端缓存必须在通知前失效，图片内容必须由所属租约沿正式媒体入口读取。
- 缺失资源的 null 结果必须与正结果共同服从闲置条数预算，资源失效或预算逐出后重新核对；读取异常严禁进入结果缓存，下次明确活跃请求重试。
- 联合配置资源必须消费 Core／Mod 的实际配置和版本，UI 图标从 graphics.ui 解析；展示消费者使用返回的 `ResourceRef`。
- 规格纹理数组引用必须携带完整字段路径；失效依据实际授权引用接纳，引擎样式选项复用合并后的正式目录。
- 静态武器及装配绘制必须共用正式层序、原点、发射点与有效 Skin 来源，已装载导弹消费实际弹体资源。
- 静态缩略图与预读必须共用成品需求和在途任务，原图工作引用在绘制完成后释放；返回可见区复用当前签名的完成画面。
- 预读只允许请求所属视口上下各一个视口的邻近资源，窗口预读只允许四项并发；失效、session 关闭和窗口销毁必须清理所属解码及依赖成品，迟到值服从所属票据。
- 驻留图片与成品必须提供同步就绪消费；成品身份包含 session、来源代次、实际绘制参数、尺寸和 DPR，成品只允许消费正式领域绘制。
