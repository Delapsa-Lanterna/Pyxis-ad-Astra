# Module Map

本文件维护模块文档规范与模块索引。

## 模块文档规范

### 登记与归属

- 模块文档必须直接放在 `.zcode/modules/`，文件名必须为英文 kebab-case `.md`。
- 模块、索引与文档必须一一对应，索引名称必须与文档 H1 一致。
- 文件必须按实际职责确定唯一主归属，目录必须符合项目分层。
- 共享实现必须登记唯一拥有者；跨模块入口必须登记拥有与消费关系。
- 测试必须归对应生产模块；资产、配置和工程入口必须归加载、装配或维护模块。
- 文件布局必须优先复用现有目录；新增目录必须有明确职责依据。

### 章节结构

- 文档必须以唯一的一行 H1 开头，标题必须为索引中的中文模块名。
- H2 必须依次为：定义、参考、边界、链路、规范、陷阱。
- 每个 H2 必须且只允许出现一次。
- `定义` 必须只用一行非空正文、一句话说明模块作用，严禁实现细节。
- `参考` 必须至少有 3 条关键文件或目录记录，并注明职责。
- `边界` 必须至少有 5 条，登记职责、状态、读写权限和消费关系。
- `链路` 只允许按真实调用顺序记录正式流程。
- `规范` 必须至少有 5 条，登记能约束实现的长期契约。
- `陷阱` 必须至少有 3 条具体边界风险，严禁与规范重复。

### 书写格式

- 模块文档只允许最多 300 行。
- `参考` 每行必须为 反引号路径+全角冒号+非空备注。
- 参考路径必须是仓库内存在的单个相对文件或目录，必须唯一并按路径字典序排列。
- H3 只允许在 `链路` 出现，每条链路必须有唯一的 H3。
- 每个 H3 必须对应非空有序列表，编号必须从 `1.` 连续递增。
- 除链路及明确表示顺序的内容外，同级条目必须按字典序排列。
- `边界`、`规范`、`陷阱` 只允许使用紧凑无序列表。
- 无序列表必须使用 `- `，每项必须单行、唯一。
- 无序条目必须按去除反引号后的正文字符序排列。
- 标题前后必须各有一个空行，列表与参考记录内部严禁空行。
- 正文只允许包含规定标题、定义正文、参考记录和列表。
- 模块正文严禁引用其它模块文档文件名。
- `规范` 和 `陷阱` 的条目严禁以文件开头。
- 严禁续行、缩进、额外空行和行尾空白；文件必须以一个换行符结束。

### 维护规则

- 文档必须依据当前实现，规则必须明确对象和约束，严禁空话与重复。
- 只允许因长期契约变化更新文档；新增文档必须先登记索引。
- 严禁记录阶段进度、实现清单、测试计划、临时方案和后续计划。
- API 文档必须与项目实现文档分开。
- 如果不知道怎么写模块文档，可以读取一些现存的模块文档作为例子。

## 模块索引

### 正式模块

- [统一右键菜单](modules/context-menu.md)：说明业务根登记、选区操作、刷新回调与标题栏动作。
- [应用启动与窗口挂载](modules/app-runtime.md)：说明原生窗口上下文、settings 初始化、唯一窗口壳、窗口根装配和应用启动失败呈现。
- [多窗口机制](modules/app-windowing.md)：说明类型化 identity、Rust 原生实例登记、目标占用、跨窗口事件与会话关闭守卫。
- [应用设置与主题](modules/app-settings.md)：说明 settings store、主题令牌、editMode、日志目录、persistence/mirror 与子窗口 snapshot。
- [后端能力与 IPC 传输](modules/backend-capabilities.md)：说明最小传输、透明错误、command 归属与公开能力授权。
- [应用反馈与错误恢复](modules/app-feedback.md)：说明反馈工厂、确认、诊断文案和授权文件恢复。
- [应用日志](modules/app-log.md)：说明日志能力、性能装配、best-effort、路径与维护。
- [工具配置维护](modules/app-config.md)：说明工具目录、配置清理范围与危险动作接纳。
- [Core 索引与加载](modules/core-assets.md)：说明根代次、fields/graphics 独立状态、读取与释放。
- [目录打开](modules/directory-opening.md)：说明目录选择、游戏或 Mod 识别、canonical root、ProjectSession 建立与打开 outcome。
- [新建 Mod](modules/mod-creation.md)：说明 Mod 父目录、最小目录骨架、`mod_info.json` renderer 与创建后的受信 session 打开。
- [工作区运行态与持久化](modules/workspace.md)：说明多 Mod 页签、导航上下文、workspace 快照、启动恢复、移除 Mod 与活动 Mod 同步。
- [项目会话与清单缓存](modules/project-session.md)：说明 `sessionId + modRoot`、实体来源、两族诊断、原子投影、提交恢复与代次接纳。
- [项目查询与缓存](modules/project-query-cache.md)：说明类型化 query identity、缓存容量、读取票据、失效、只读记录和 pending gate。
- [文本与格式解析器](modules/text-parsers.md)：说明 CSV-like 与 JSON-like 解析、UTF-8 无 BOM、CP1252 规范化和格式错误上下文。
- [表格编辑](modules/csv-tables.md)：说明窗口化表格 query、tables store、行身份、选择、列 schema 渲染与 dirty。
- [表格草稿历史](modules/csv-edit-history.md)：说明按 Mod/表隔离的内存 operation、CSV undo/redo、rowKey 映射和 history limit。
- [表格保存与变更集](modules/table-save-changeset.md)：说明 dirty patches、关联 spec 动作、原子 changeset、rowKey map 与保存后提交。
- [编辑会话原语](modules/draft-session.md)：说明完整目标快照、读取票据、保存等待、EditContext、快照历史与未保存注册表。
- [联合编辑与目标交接](modules/joint-editing.md)：说明联合来源快照、物理写入范围、跨编辑面保存准备、三方冲突选择、原子提交及释放。
- [沉浸式编辑器](modules/immersive-editors.md)：说明领域内容渲染器、只读与编辑能力、窗口壳、字段浮层、装配动作、候选读取、悬浮信息与联合会话生命周期交接。
- [字体](modules/fonts.md)：说明原版字体读取、逐字体回退、缺字问号、文字测量、共享图集和展示生命周期。
- [文件历史与回放](modules/file-history.md)：说明已写盘 changeset、按 Mod 隔离的文件级 undo/redo、确认回放与 session refresh。
- [主窗口历史命令与快捷键分发](modules/main-history-command.md)：说明快捷键命令映射、统一分发器、CSV 草稿优先级与文件 history 分派。
- [画布编辑器骨架](modules/editor-canvas.md)：说明画布命中检测、选区同步、镜像轴、光标绘制、undo 集成与显式 draft 提交引擎。
- [Mod 文件浏览器](modules/mod-file-browser.md)：说明按 session 隔离的目录树、内容判定、读取接纳与文本窗口交付。
- [文件编辑器](modules/file-editor.md)：说明独立文本窗口、`sessionId + modRoot + path`、文本 Draft Session、保存和外部文本同步。
- [配置系统](modules/config.md)：说明 mod_info、Faction、Mission、Variant、Skin、目标草稿、实体 query/write 与文件级 history。
- [字段模式系统](modules/schema.md)：说明 schema 资产加载、runtime、字段渲染、editMode、校验、引用 source、SelectOption 与资源选择。
- [配置实体族编辑器](modules/family-editors.md)：说明装配与皮肤两族参数化编辑、family 定义、实体 query/write 和单文件保存。
- [舰船编辑器](modules/ship-editor.md)：说明 `.ship` 画布注入、槽位、引擎、shield、贴图引用选择与独立窗口保存。
- [武器编辑器](modules/weapon-editor.md)：说明武器编辑、依赖读取、资源及预览快照交付。
- [弹体编辑器](modules/projectile-editor.md)：说明弹体与导弹字段、引擎、规格查询及保存交接。
- [武器开火预览](modules/weapon-fire-preview.md)：说明预览来源、只读查询、模拟、播放控制与独立窗口生命周期。
- [战术系统编辑器](modules/system-editor.md)：说明 `.system` spec、schema 表单、type 条件字段与独立窗口保存。
- [资源与原版回退](modules/assets-core-fallback.md)：说明 `ResourceRef`、Mod/Core 优先级、批量 data URL、引用选择、媒体预算、可见资源集合及 Core 来源目录缓存。
- [后端文件读写与变更集](modules/rust-file-io-changeset.md)：说明 UTF-8 IO、canonical 路径、父链校验、文件或目录快照与 replay。
- [性能基线](modules/performance-baseline.md)：说明正式计时日志、可复现样本、ProjectSession 阶段、持久化索引和入口 bundle 体积。
- [静态检查系统](modules/static-checks.md)：说明文本、格式配置、架构静态检查与模块文档契约的入口、边界和规则自检原则。
- [关于页面](modules/about-page.md)：说明主窗口只读信息页、构建时内联 `CHANGELOG.md`、marked 渲染与 about 路由。
