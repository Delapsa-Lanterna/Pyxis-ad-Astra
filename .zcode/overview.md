# Overview

星界罗盘 [Pyxis ad Astra] 是一个 Windows 桌面 Starsector Mod 配置工具，统一管理 Mod 表格、规格、配置实体和文件编辑，并提供受控的保存、历史、资源和窗口能力。

## 项目目标

- 以项目会话隔离实体读取、授权写入、缓存、草稿、历史和窗口状态。
- 保存、回放、外部更新和窗口交接遵循统一的目标、版本和生命周期原则。
- 提供字段编辑、舰船与武器画布、弹体编辑、只读开火预览、Mod 文件树浏览和资源引用。
- 管理已加载 Mod 的 CSV、`.ship`、`.wpn`、`.proj`、`.system` 规格和配置实体。

## 技术栈

- Canvas 2D
- Naive UI
- Pinia
- Rust
- Tauri 2
- Vite
- Vue 3 + TypeScript

## 宏观层级

本节按前后端源码根下的一级目录说明分层职责与调用边界。业务模块及文件归属见模块索引与所属模块文档，项目执行流程见项目内关键链路。

### 前端

- `src/app/`：窗口根、页面、组件、检查器与 ViewModel/composable 的展示、交互和应用装配；领域规则与后端能力必须由所属层交付。
- `src/domain/`：编辑会话、表格、字段模式、配置、设置、工作区和编辑器的纯规则与转换；严禁依赖 app、services、stores 或 windows。
- `src/orchestrators/`：保存、打开、导航、历史、刷新、生命周期和身份交接的业务编排，协调所属状态与能力的执行顺序。
- `src/services/`：单一后端能力包装、参数装配和结果交接；组件、store 和 domain 严禁直接调用跨进程能力。
- `src/shared/`：公共协议、原语、工具与控件；原始 `invoke` 只允许由 `command.runtime` 消费。
- `src/stores/`：会话、清单、表格、历史、设置、Core 和工作区的内存运行态；严禁拥有 IO、确认框或跨模块编排。
- `src/styles/`：全局主题、应用框架和业务样式。
- `src/windows/`：窗口 identity、结构化上下文、请求回执、原生实例、事件过滤、关闭请求和销毁生命周期。

### Rust

- `src-tauri/src/commands/`：接收 wire 参数、访问应用状态、转换错误并调用所属服务。
- `src-tauri/src/services/`：维护业务状态、会话生命周期、查询、保存协调、资源与平台能力，消费领域规则、解析及 IO；业务函数必须由服务装配直接从所属实现导出，query 只允许读取。
- `src-tauri/src/domain/`：实体定义、编辑目标、资源引用、内容构造及业务投影的纯规则与转换。
- `src-tauri/src/io/`：canonical 路径边界、文件读写、目录快照、改名和 changeset 应用。
- `src-tauri/src/parsers/`：CSV-like、JSON-like、spec 和文本的解析、渲染及诊断位置。
- `src-tauri/src/models/`：wire 模型、内部模型、归一化映射和结构化错误数据。

### 共同资产

- `schemas/`：配置字段、CSV 列和实体默认模板资产，由字段模式与实体构造能力分别维护，前后端经所属正式入口加载。

### 公共文件

- 业务模块只允许消费公共文件；正式模块依赖必须由具有业务归属的文件关系计算。
- 公共协议、错误、读取、缓存与测试基础严禁作为正式模块内容；前后端对应数据定义必须采用相同归属。
- 公共文件范围必须在模块索引的公共文件清单登记，shared 目录及共址测试必须保留公共属性。

## 项目内关键链路

- 应用启动：`main.ts` → `initializeWindowContext` 接纳原生 bootstrap 与路径映射 → 根组件与正式 settings 并行加载 → Pinia、日志与性能装配 → 唯一 `WindowShell` → `showCurrentWindow`
- 启动失败：`bootstrap()` 失败 → `failWindowStartup` 结束请求交付 → 卸载已挂载应用 → `StartupFailure` 展示原始诊断 → 当前窗口显示与重试、复制或退出
- 工作区恢复：`beginWorkspaceRestore` 暂停自动保存 → 工具私有 `PersistedWorkspace` → `restorePersistedWorkspace` 捕获代次并重建游戏概览及 Mod session → 正式清单与运行态水合 → `finishWorkspaceRestore` 处理所属最终快照
- 工作区持久化：Mod、目录、引用设置或列宽变化 → `watchWorkspacePersistence` 提取可恢复投影 → workspace service → Rust 写入工具私有快照 → 所属保存与关闭等待完成
- 目录与会话：目录选择或游戏概览中的 Mod 打开动作 → `openWorkspaceDirectory` 或所属打开编排 → 目录识别与正式 Mod 根 → `open_project_session` 授权根并装载来源 → `ProjectManifest` → 按捕获代次登记工作区
- 新建 Mod：工作区捕获游戏根或明确父目录与创建参数 → Mod 创建编排 → Rust 授权父目录并写入目录骨架及 `mod_info.json` → 实际 `modRoot` → 工作区打开与结果反馈
- 导航与定位：菜单、快捷键或业务引用捕获目标 → 等待保存及同步并提交活动输入 → 工作区导航与所属页面挂载 → 按需读取、实体选择与滚动，或关于页内联 `CHANGELOG.md` 的 marked 渲染
- 窗口创建与复用：`WindowIdentity` 与结构化输入 → managed window → Rust 登记、目标占用与实例创建或复用 → 接收方领取请求并加载业务基线 → `requestId + receiverGeneration` 回执 → 发起动作完成
- 引用来源与内容组合：工作区标签顺序及引用开关 → `publishReferenceSources` → 后端有序引用快照 → 原版、前序可引用 Mod 与本地 JSON 组合 → 引用版本接纳与缓存失效 → 展示更新并保留本地草稿
- 会话查询与编辑目标：`ViewModel/composable` 捕获 session 与参数 → 类型化 query、投影门控与 `ReadTicket` → `command.runtime` → 所属 Rust query → `EntityData`、正式目标与版本 → 票据接纳只读结果或独立草稿
- 来源读取与解析：授权来源根 → 同次字节读取及 `FileVersion` → 匹配来源记录复用或 CSV-like、JSON-like、spec parser → 业务索引与诊断 → 所属打开或刷新完成时集中持久化来源成果
- CSV 编辑：表格窗口查询 → `CsvRow`、源索引与 `rowKey` → CSV store 与可视区网格 → 列 schema、原始输入及单元格动作 → 行草稿、operation 历史与 dirty → patches 和关联规格动作
- JSON 与杂项配置编辑：session 与文档类型 → 正式记录、缺失版本及 schema → JSON 文档会话 → `FieldInputs` 提交字段动作 → 本地 draft 与快照历史 → 所属创建、保存或删除动作
- Spec 字段与画布编辑：规格窗口定义 → 正式目标、规格与依赖 → 舰船、武器、弹体或战术系统 ViewModel → schema 字段或画布手势 → 领域投影与工作值 → Draft Session、历史及保存动作
- 联合与沉浸式编辑：ship、weapon、wing 或 variant 的 `JointEditRoot` → `query_joint_edit` → 规格、CSV、描述、Skin 与模块来源图 → `JointEditSnapshot` → 所属字段、装备、场景与关联编辑器动作 → 联合草稿
- 文件浏览与文本打开：宿主交付 session 与正式 Mod 根 → Mod 文件页 → 目录查询或全目录搜索 → 按 session 接纳条目 → `query_mod_text_file_target` 核对路径与内容 → 完整文件窗口请求 → 文本加载与行列定位
- 文本编辑：`EditableFileData` 与版本 → 文本 Draft Session → 原文、dirty 及文本撤销栈 → 保存时捕获文本与目标 → 实际写盘文本接纳基线 → 保留后续输入；外部差异进入待载入版本
- 项目保存：编辑面提交输入并捕获 `SaveRequest` → `save_project` → 项目同步 FIFO → 所属业务准备 → `write_transactions::begin` 与版本复核 → 业务 changeset → 历史及正式投影登记 → 发布 `WriteResult` 并释放项目工作
- 联合冲突与提交：联合基线、磁盘与提交草稿 → `submitJointEdit` 请求后端三方比较 → 独立修改合并与冲突选择 → 共享影响、Mod 覆盖和目标协调 → 确认版本复核 → 同根 changeset 与一次历史登记 → 实际联合快照
- 实体身份联动：正式实体目标、内容与文件名选择 → 实体写入能力 → 主文件、关联规格、描述、势力索引与父装配引用暂存 → 同根 changeset 应用 → 会话表格接纳 → 实际内容、行键与身份变化
- JSON 写入确认：捕获 `preserveOriginalJson` → `runConfirmedJsonWrite` → 原文结构更新或逐源重排要求 → 所属窗口确认具体文件 → 绑定来源指纹与版本重试 → changeset 写入
- 缺失来源重建：已捕获的完整内容与修改 → 项目队列发现缺失来源 → 所属请求确认路径 → 重新核对现存内容及版本 → 所属保存能力重建文件与必要索引 → 实际结果接纳
- 写后接纳：`CommittedWriteEvent` 有序交付 → File History 摘要 → `sessionUpdates` 正式清单及资源、query 缓存失效 → 发起会话 `SaveAcceptanceTask` → 窗口身份交接 → 所属内容与后续草稿接纳
- 文件修改失败恢复：根租约内写入失败 → 实际 before 字节、路径与存在状态 → 逆序恢复已执行及部分执行步骤 → 受阻位置保留项目工作 → 恢复或明确放弃 → 所属请求结束与后续队列推进
- 正式登记恢复：文件及历史已登记后的投影构建失败 → session 投影标记 `pending` 并保留所属项目工作 → `project_sync::retry` 继续未完成投影登记 → 完整正式结果发布 → 释放项目工作
- 内容接纳重试：窗口内容处理失败 → `PendingWriteSync` 保留未完成步骤 → 所属重试入口 → 当前有效身份、基线或必要读取接纳 → 释放已完成步骤并结束所属待办
- 草稿历史与文件回放：workspace history dispatch → 当前 JSON 或 CSV 草稿历史 → 草稿耗尽时构造 File History replay plan → 影响文件确认 → 项目队列复核当前路径、版本与授权 → changeset replay → 历史及窗口内容交付
- 来源刷新：所属业务根刷新动作 → 保存等待与活动输入交接 → `refreshProjectSourcePaths` → 项目队列按实际来源重读 → 正式投影及失效交付 → 所属内容接纳或 dirty 外部版本暂存
- Core 生命周期：`WindowShell` 有效原版根 → `startCoreAssetsLoading` → fields 与 graphics 独立读取并复用所属在途任务 → 后端 Core 产品 → 根与产品代次接纳 → Core store；根清空或窗口释放撤销所属读取
- 资源读取与展示：后端授权 `ResourceRef` → 媒体集合与租约 → media 合批、共享读取及 Mod/引用/Core 根授权 → data URL → 窗口图像解码及缩略图成品 → 展示；引用替换、失效或释放交还所属租约
- 字体加载与绘制：沉浸式窗口登记字体身份 → `ReadTicket` → 指定目录或所属游戏根的 FNT 与图集 → 字体解析、解码及来源回退 → `FontText` 排版与 canvas 绘制 → 来源切换或窗口释放清理所属字体
- 武器开火预览：已保存武器或独立 draft 快照 → weapon-fire-preview 窗口请求 → 武器、CSV 与弹体读取接纳 → 播放状态与帧循环 → 领域发射模拟及共享场景绘制 → 提交失效重读或窗口释放
- 设置保存与镜像：主窗口 settings 编辑值 → 唯一保存队列 → Rust 权限、校验、规范化与写盘 → 运行参数、revision 及正式 snapshot → 全部窗口按版本接纳 → 缓存预算与历史容量生效
- 主题与输入模式：正式设置及系统主题 → settings store 派生主题令牌与字体 → 唯一主题 DOM effect 及 Naive Provider；`editMode` 变化 → 所属输入集合确认交接 → 字段控件接纳实际模式
- 原版来源切换：设置页捕获目标根与工作区 → `switchWorkspaceCoreSource` 等待已登记动作 → 根授权与关闭确认 → 实际 session 释放 → 设置提交 → 按捕获 Mod 列表重开 → 最终工作区快照与结果反馈
- 关闭与释放：window、sessions 或 application 的 `CloseScope` → 保存及待同步工作结束 → 当前 dirty 与活动输入复核 → 所属确认及设置、日志、性能交付 → Rust 销毁并等待 `Destroyed` → 项目同步完整释放 → `releasedSessions` → 工作区、内容与缓存释放
- 错误呈现与恢复：原始 `AppError`、稳定码、location 与 payload → 所属窗口反馈 → 用户文案、原始诊断日志及授权文件动作 → recovery 窗口或明确业务重试 → 实际动作结果与一次最终反馈
- 文本编码转换：`text.invalid_utf8` 与授权目标 → 用户选择源编码 → 后端重读并检查当前字节 → 仍需转码时完整解码并写入 changeset → 正式回执 → 受影响会话及文本窗口接纳
- 工具目录维护：设置页目录打开动作 → 配置 service → `app_data_dir::data_directory` → 工具目录创建 → 系统打开能力 → 所属窗口接纳实际结果
- 日志交付与维护：业务事件或原生诊断 → 所属窗口、进程记录队列 → `append_app_logs` → 正式日志目录与串行轮转追加 → 状态反馈；清空及正常关闭先交付所属尾批
- 性能采集与报告：正式运行开关 → 窗口采集与批量交付 → 后端时间线及统计 → 设置动作导出 JSON 报告；外部 CPU 采样连接实际 DevTools 页面 → cpuprofile 与采样连接释放
- 静态检查与构建：项目文件与语言解析 → 依赖、调用及归属事实 → 架构、文本与模块文档规则 → 定位诊断及退出码；类型检查、行为测试与前端/Tauri 构建交付所属验证结果
- 浏览器验收与性能评估：browser/testbed 场景与完整窗口替身 → 正式应用组件及浏览器构建 → 功能动作或性能负载 → 断言、控制台诊断、截图与统计 → 实际报告及退出码
