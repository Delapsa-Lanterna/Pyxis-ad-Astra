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

### 前端

- `schemas/`：配置字段、CSV 列和规格默认模板资产，经正式加载 owner 消费。
- `src/app/`：窗口根、页面、组件、检查器与 ViewModel/composable；应用装配在这里收口，不承载领域规则与后端能力。
- `src/domain/`：编辑会话、表格、schema、配置、设置、workspace 和编辑器的纯规则与转换；严禁依赖 app、services、stores 或 windows。
- `src/orchestrators/`：保存、打开、导航、历史、刷新、生命周期和身份交接；项目同步模块拥有来源刷新、提交接纳、缓存失效、恢复及通知，项目会话拥有清单与读取门控。
- `src/services/`：单一后端能力包装、参数装配和结果交接；业务查询拥有参数、结果与失效定义，会话缓存消费类型化定义及正式门控；跨进程能力不得由组件、store 或 domain 直接调用。
- `src/shared/`：`command.runtime`、wire 类型、错误、读取票据、缓存、事件和纯工具；原始 `invoke` 只允许由 `command.runtime` 消费。
- `src/stores/`：内存运行态、manifest、表格、历史、设置、Core 和 workspace 状态；严禁拥有 IO、确认框或跨模块编排。
- `src/styles/`：全局主题、应用框架和业务样式。
- `src/windows/`：窗口 identity、结构化上下文、请求回执、原生实例、事件过滤、关闭请求和销毁生命周期。

### Rust

- `src-tauri/src/commands/`：处理 wire 参数、状态访问、错误转换和 service 调用。
- `src-tauri/src/domain/`：保存实体定义、编辑目标、资源引用、Mod 创建规则和纯业务投影。
- `src-tauri/src/io/`：保存 canonical 路径边界、文件读写、目录快照、改名和 changeset 应用。
- `src-tauri/src/models/`：保存 wire 模型、内部模型、归一化映射和结构化错误数据。
- `src-tauri/src/parsers/`：保存 CSV-like、JSON-like、spec 和文本解析、渲染及诊断位置。
- `src-tauri/src/services/project/sources/`：按实际来源根交付匹配内容与版本，维护解析成果复用、Core 文档目录及来源持久化。
- `src-tauri/src/services/project/`：按 root、session、query、write、resources、cache 和 model 分工；query 只读，write 返回实际 changeset、版本和 invalidation。
- `src-tauri/src/services/write_transactions/`：保存提交模块维护项目文件事务、失败恢复与正式结果登记；项目同步持有所属项目队列并独立发布结果。
- `src-tauri/src/services/`：提供目录打开、workspace、ProjectSession、配置、文件、设置、日志、Core、资源和窗口能力；业务函数由服务装配直接从所属实现导出。

### 公共文件

- 业务模块只允许消费公共文件；正式模块依赖必须由具有业务归属的文件关系计算。
- 公共协议、错误、读取、缓存与测试基础严禁作为正式模块内容；前后端对应数据定义必须采用相同归属。
- 公共文件范围必须在模块索引的公共文件清单登记，shared 目录及共址测试必须保留公共属性。

## 跨层链路

- Core 生命周期：`WindowShell` 所属上下文 → 后端有效原版根查询 → Core orchestrator → fields/graphics command → Rust Core index → root generation → Core store
- workspace 生命周期：workspace action → Rust 关闭范围登记 → 内容准备与逐窗确认 → Destroyed → session 释放 → 实际释放结果 → 前端运行态清理
- 保存事务：`EditSession` → save orchestrator → 目标与版本准备 → write service → `command.runtime` → Rust FIFO transaction → changeset、`File History` 与 `ProjectSession projection` → `WriteResult`
- 写后接纳：项目保存队列 → 文件、历史及正式内容登记 → 实际 `WriteResult` 发布与保存工作释放 → 消费者有序接纳历史、清单、缓存、身份及内容
- 历史回放：main history dispatch → 当前编辑面的 JSON 或 CSV draft history → `File History` replay plan → 当前路径和版本复核 → changeset replay → `ProjectSession refresh`
- 查询与编辑目标：组件 → `ViewModel/composable` → query service → `command.runtime` → Rust `ProjectSession` query → parser/IO/cache → `EntityData`、`EntityEditTarget` 与 `ResourceRef` → 前端 query cache
- 目录与会话：目录选择 → `directory-opening orchestrator` → `detect_directory` → canonical root → `open_project_session` → `ProjectSession` → workspace runtime
- 窗口生命周期：业务 identity → window service → Rust native registry → 原生窗口上下文与请求 → 接纳回执 → 标题、目标和 dirty 接纳 → close guard 与释放
- 资源读取：`ResourceRef` → resource-reference service → Rust root authorization → Mod/Core resource query → resource/media cache → 组件展示

## 项目内关键链路

- Core fields 与 graphics 必须由同一 WindowShell 生命周期分别加载；root、generation、A-B-A、根清空和窗口销毁是唯一接纳条件。
- JSON draft history、CSV draft history 与 File History 分别归所属 owner；当前文档快照与表格 operation 必须先于文件回放处理。
- `ReadTicket` 必须同时拥有读取身份、取消信号、Promise 和接纳状态；失效或关闭只结束所属等待，迟到结果不得写入新生命周期。
- `ResourceRef` 必须由后端授权并绑定 session、source 和规范化相对路径；Core fallback 只读，不能把 Core 内容写入 Mod。
- Rust 设置服务必须串行持有设置写盘、运行参数及正式 snapshot；全部窗口必须先监听再读取并按 revision 接纳，主窗口必须独占编辑值和保存队列。
- `WriteResult` 必须按 File History、正式清单、resource/query cache、所属身份和内容交接的顺序消费；保存成功必须由项目文件、历史和正式内容登记结果决定。
- dirty 或 saving 窗口必须先拦截关闭；保存、pending 恢复和最新 dirty 判定完成前不得销毁窗口、移除 Mod 或关闭 session。
- replay 必须重新校验当前路径、父链、版本、session 和目标；历史记录只能提供候选 changeset，不提供当前授权。
- `sessionId + modRoot` 必须贯穿 ProjectSession、query、write、cache、history、window 和事件；任何调用不得使用活动 Mod、裸路径或字符串拼接补齐身份。
- workspace、settings、日志和派生索引只允许写工具私有目录；Mod、Core 和用户外部目录必须由所属 path owner 授权。
- 媒体 owner、集合租约、图像解码和缩略图成品必须共同服从引用生命周期；可见媒体必须增量释放，菜单与已选值资源不得互相覆盖。
- 实际编辑目标只能由 `query_entity_edit_target`、`query_text_identity_intent` 或后端恢复目标提供；前端不得扫描磁盘或构造正式目标。
- 已执行动作必须消费捕获的业务目标，终结反馈必须归所属窗口；页面读取必须按所属展示生命周期接纳。
- 当前 Mod 选择、当前清单与 session 派生必须归工作区；项目会话必须按明确 Mod 根交付正式清单与 session。
- 所有写入必须经过 `write_transactions::begin`、版本复核和统一 `WriteResult`；组件、store、query 和资源能力不得直接写文件。
- 窗口 identity 必须包含完整 session、`modRoot`、kind 和业务目标；原生 label、目标占用、可重载上下文、标题、事件过滤和 ViewModel 目标必须共同交接。
- 结构化错误必须保留稳定码、原始诊断、路径、行列、action、command 和 payload；用户文案、日志诊断和恢复授权不得互相推导。
