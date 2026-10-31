# Module Map

本文件维护模块文档规范与模块索引。

## 模块文档规范

### 登记与归属

- 模块文档必须直接放在 `.zcode/modules/`，文件名必须为英文 kebab-case `.md`。
- 模块、索引与文档必须一一对应，索引名称必须与文档 H1 一致。
- 业务文件必须按实际职责确定唯一主模块，目录必须符合项目分层。
- 模块文档严禁包含 CSS 文件引用和样式规则。
- 公共文件必须独立登记，严禁拥有模块归属或作为正式模块内容。
- 模块文档引用公共文件只允许使用消费或关联，业务入口必须登记拥有与消费关系。
- 测试必须继承对应实现的业务归属或公共属性；资产、配置和工程入口必须按实际职责登记。
- 文件布局必须优先复用现有目录；新增目录必须有明确职责依据。

### 章节结构

- 文档必须以唯一的一行 H1 开头，标题必须为索引中的中文模块名。
- H2 必须依次为：定义、参考、边界、链路、规范。
- 每个 H2 必须且只允许出现一次。
- `定义` 必须只用一行非空正文、一句话说明模块作用，严禁实现细节。
- `参考` 必须至少有 3 条关键文件或目录记录，并注明职责。
- `边界` 必须至少有 5 条，登记职责、状态、读写权限和消费关系。
- `链路` 只允许按真实调用顺序记录正式流程。
- `规范` 必须至少有 5 条，登记能约束实现的长期契约。

### 书写格式

- 模块文档只允许最多 300 行。
- `参考` 必须按拥有、消费、装配、关联的固定顺序使用 H3，空分组必须省略。
- 拥有必须登记本模块维护的实现、契约及资产，测试文件必须继承实现归属。
- 模块文档严禁引用 .spec、.test、.check 及 Rust _test、_tests 命名的测试文件；测试归属必须按实现或所属目录推导。
- 消费必须登记本模块使用的外部能力；装配必须登记连接本模块的外部宿主。
- 关联必须登记上下文、跨职责内容或其它关联证据。
- 参考分组必须使用紧凑 `- 反引号路径+全角冒号+非空备注` 列表，组内必须按路径字典序排列。
- 参考路径必须是仓库内存在的单个相对文件或目录，在同一文档全部分组中必须唯一。
- 拥有目录必须覆盖其全部后代文件，跨模块的拥有声明严禁重叠。
- H3 只允许在参考与链路出现；同一章节内的 H3 必须唯一。
- 链路的每个 H3 必须对应非空有序列表，编号必须从 `1.` 连续递增。
- 字典序检查只允许用于 `参考` 的参考路径；其它章节的条目必须按职责或阅读顺序排列。
- `边界`、`规范` 只允许使用紧凑无序列表。
- 无序列表必须使用 `- `，每项必须单行、唯一。
- `边界`、`规范` 条目必须保持唯一，顺序必须服从职责与阅读关系。
- 标题前后必须各有一个空行，列表与参考记录内部严禁空行。
- 正文只允许包含规定标题、定义正文、参考记录和列表。
- 模块正文严禁引用其它模块文档文件名。
- `规范` 的条目严禁以文件开头。
- 严禁续行、缩进、额外空行和行尾空白；文件必须以一个换行符结束。

### 维护规则

- 文档必须依据当前实现；规范必须明确对象和约束，优先正面表述；约束用语只允许用于规范与约束，严禁空话与重复。
- 只允许因长期契约变化更新文档；新增文档必须先登记索引。
- 严禁记录阶段进度、实现清单、测试计划、临时方案和后续计划。
- 如果不知道怎么写模块文档，可以读取一些现存的模块文档作为例子。

## 公共文件

- `scripts/shared/`：工程检查与浏览器验收共享的仓库遍历、语言解析、位置及样本统计工具。
- `src-tauri/src/app_data_dir.rs`：Tauri 工具私有数据目录解析。
- `src-tauri/src/diagnostics.rs`：跨层诊断写入接口。
- `src-tauri/src/errors.rs`：错误、位置与诊断公共定义。
- `src-tauri/src/json_overlay.rs`：JSON 值的对象递归覆盖与数组、叶值整体替换纯运算。
- `src-tauri/src/models/`：前后端协议、模型与公共数据转换。
- `src-tauri/src/test_support.rs`：Rust 测试共享文件工作区、路径夹具与进程隔离。
- `src-tauri/src/test_support_tests.rs`：Rust 测试工作区的分配、释放与并发验证。
- `src/app/components/editors/common/`：编辑与预览共同的标题、页脚、检查器和保留输入的分组展示。
- `src/app/composables/use-query-read-owner.ts`：Vue 读取票据的作用域交接。
- `src/domain/cache-limits.ts`：缓存预算的前端校验。
- `src/domain/project/entity-definitions.ts`：实体内容 ID、可用 ID 规则与目标身份纯投影。
- `src/shared/`：前端公共协议、原语、工具与控件。
- `src/styles/`：按业务及关联组件组织的展示规则与样式入口。
- `src/test/fixtures/`：共享测试数据工厂。
- `src/test/test-foundations.spec.ts`：公共测试基础设施验证。
- `src/test/unit/`：单元测试挂载、控件与运行时辅助。

## 模块索引

### 正式模块

- [统一右键菜单](modules/context-menu.md)：说明业务根登记、选区操作、刷新回调与标题栏动作。
- [应用启动与窗口挂载](modules/app-runtime.md)：说明原生窗口上下文、settings 初始化、唯一窗口壳、窗口根装配和应用启动失败呈现。
- [多窗口机制](modules/app-windowing.md)：说明类型化 identity、Rust 原生实例登记、目标占用、跨窗口事件与会话关闭守卫。
- [应用设置与主题](modules/app-settings.md)：说明 settings store、主题令牌、editMode、日志目录、persistence/mirror 与子窗口 snapshot。
- [后端能力与 IPC 传输](modules/backend-capabilities.md)：说明最小传输、透明错误、command 归属与公开能力授权。
- [应用反馈与错误恢复](modules/app-feedback.md)：说明反馈工厂、确认、诊断文案和授权文件恢复。
- [应用日志](modules/app-log.md)：说明四档记录、自动过程事件、批量写入、进程停写及文件维护。
- [工具配置维护](modules/app-config.md)：说明工具私有目录创建与系统打开。
- [Core 索引与加载](modules/core-assets.md)：说明根代次、fields/graphics 独立状态、读取与释放。
- [目录打开](modules/directory-opening.md)：说明目录选择、游戏或 Mod 识别、canonical root、ProjectSession 建立与打开 outcome。
- [新建 Mod](modules/mod-creation.md)：说明 Mod 父目录、最小目录骨架、`mod_info.json` renderer 与创建后的受信 session 打开。
- [工作区运行态与持久化](modules/workspace.md)：说明多 Mod 页签、导航上下文、workspace 快照、启动恢复、移除 Mod 与活动 Mod 同步。
- [项目会话与投影](modules/project-session.md)：说明 `sessionId + modRoot`、生命周期、原子投影、提交恢复与代次接纳。
- [项目来源读取](modules/project-sources.md)：说明授权来源、带版本读取、解析复用、来源缓存与持久化。
- [项目同步](modules/project-sync.md)：说明来源刷新、提交接纳、同步重试、缓存失效与跨窗口通知。
- [项目查询与缓存](modules/project-query-cache.md)：说明类型化查询定义、会话共享读取、缓存、门控与失效通知。
- [实体查询](modules/entity-query.md)：说明实体详情、列表、编辑目标、身份意图及所属失效。
- [文本与格式解析器](modules/text-parsers.md)：说明 CSV-like 与 JSON-like 解析、UTF-8 无 BOM、CP1252 规范化和格式错误上下文。
- [CSV 文档编辑](modules/csv-editor.md)：说明整表运行态、行草稿、操作历史、输入、关联文件及原子保存。
- [编辑会话原语](modules/draft-session.md)：说明完整目标快照、读取票据、文档保存队列、EditContext、快照历史与未保存注册表。
- [联合编辑与目标交接](modules/joint-editing.md)：说明联合来源快照、物理写入范围、跨编辑面保存准备、三方冲突选择、原子提交及释放。
- [沉浸式编辑器基础](modules/immersive-editor.md)：说明共同运行态、字段展示、来源选择、资源与船体场景。
- [沉浸式舰船编辑器](modules/immersive-ship-editor.md)：说明舰船及皮肤字段、有序来源、基础统计与只读信息内容。
- [沉浸式武器编辑器](modules/immersive-weapon-editor.md)：说明武器信息、分支动作与弹体打开。
- [沉浸式战机联队编辑器](modules/immersive-wing-editor.md)：说明战机联队信息、来源补全、引用与行身份跟随。
- [沉浸式装配编辑器](modules/immersive-variant-editor.md)：说明装配投影、装备动作、模块导航与候选交互。
- [字体](modules/fonts.md)：说明原版字体读取、逐字体回退、缺字问号、文字测量、共享图集和展示生命周期。
- [项目保存调度](modules/project-save.md)：说明完整保存请求、业务准备、项目排队及实际结果返回。
- [保存提交](modules/write-commit.md)：说明公共保存事务、提交记录、保存回执及指定提交恢复。
- [文件历史与回放](modules/file-history.md)：说明已写盘 changeset、按 Mod 隔离的文件级 undo/redo、确认回放与 session refresh。
- [Spec 编辑器基础](modules/spec-editor.md)：说明规格宿主、基础契约、文档交接与四类实现装配。
- [画布编辑器骨架](modules/editor-canvas.md)：说明画布交互、选区、镜像、动作提交及唯一共享引擎绘制与运行态。
- [Mod 文件浏览器](modules/mod-file-browser.md)：说明按 session 隔离的目录树、内容判定、读取接纳与文本窗口交付。
- [文件编辑器](modules/file-editor.md)：说明独立文本窗口、`sessionId + modRoot + path`、文本 Draft Session、保存和外部文本同步。
- [字段模式系统](modules/schema.md)：说明 schema 资产加载、runtime、字段渲染、editMode、校验、引用 source、SelectOption 与资源选择。
- [JSON 文档编辑](modules/json-editor.md)：说明 Mod 信息、势力、战役、装配与皮肤的文档会话、草稿历史、共同列表与宿主、类型规则及统一保存。
- [杂项配置](modules/misc-config.md)：说明已登记文件的路径、读取、创建、保存、删除及文件历史交接。
- [Spec 舰船编辑器](modules/spec-ship-editor.md)：说明 `.ship` 画布注入、槽位、引擎、shield、贴图引用选择与独立窗口保存。
- [Spec 武器编辑器](modules/spec-weapon-editor.md)：说明武器编辑、依赖读取、资源及预览快照交付。
- [Spec 弹体编辑器](modules/spec-projectile-editor.md)：说明弹体与导弹字段、引擎、规格查询及保存交接。
- [武器开火预览](modules/weapon-fire-preview.md)：说明预览来源、只读查询、世界坐标调度、共享绘制、尾迹与独立窗口生命周期。
- [Spec 战术系统编辑器](modules/spec-system-editor.md)：说明 `.system` spec、schema 表单、type 条件字段与独立窗口保存。
- [资源与原版回退](modules/assets-core-fallback.md)：说明 `ResourceRef`、Mod/Core 优先级、媒体预算、可见资源集合、引擎样式与逐槽位贴图查询及 Core 来源目录缓存。
- [后端文件读写与变更集](modules/rust-file-io-changeset.md)：说明 UTF-8 IO、canonical 路径、父链校验、文件或目录快照与 replay。
- [性能监视](modules/performance-monitor.md)：说明正式应用自动计时、运行开关、独立缓冲、时间线报告与 CPU 采样。
- [浏览器预览与测试](modules/browser-testing.md)：说明浏览器预览、场景与窗口替身、功能验收、testbed、性能评估与报告。
- [静态检查系统](modules/static-checks.md)：说明文本、格式配置、架构静态检查与模块文档契约的入口、边界和规则自检原则。
- [关于页面](modules/about-page.md)：说明主窗口只读信息页、构建时内联 `CHANGELOG.md`、marked 渲染与 about 路由。
