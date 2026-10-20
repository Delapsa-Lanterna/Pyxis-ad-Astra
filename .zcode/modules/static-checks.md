# 静态检查系统

## 定义

静态检查模块验证仓库的结构、格式和模块职责契约。

## 参考

### 拥有

- `.gitattributes`：维护文件的文本与换行属性。
- `.github/`：持续集成与完整检查装配。
- `.gitignore`：仓库产物与受控目录忽略范围。
- `.prettierignore`：格式检查的产物排除范围。
- `.prettierrc`：统一格式规则。
- `.zcode/module-map.md`：正式模块路由与模块文档格式契约。
- `.zcodeignore`：项目上下文排除范围。
- `eslint.config.js`：ESLint 配置与受控产物扫描边界。
- `rustfmt.toml`：Rust 源码格式配置。
- `scripts/architecture/`：架构规则、规则注册及合法与违规行为测试。
- `scripts/architecture/cache-settings.check.mjs`：设置启动接入精确媒体配置能力的合法与违规验证。
- `scripts/architecture/capability-boundary.check.mjs`：能力授权、规则归属和真实仓库入口的行为测试。
- `scripts/architecture/command-boundary.check.mjs`：command 来源、词法作用域与 验收。
- `scripts/architecture/docs-module-map.check.mjs`：模块文档严格格式、参考路径与索引对应的行为测试。
- `scripts/architecture/engine-rendering.check.mjs`：必须验证引擎效果绘制与颜色解析的唯一入口约束。
- `scripts/architecture/project-sources.check.mjs`：来源读取、表格缓存、资源消费者及业务动作依赖边界的验证。
- `scripts/architecture/project-sync-boundary.check.mjs`：项目同步基础边界、项目选择及 Core 根输入的运行时、类型和动态引用验证。
- `scripts/architecture/query-foundations.check.mjs`：会话查询、业务定义与预算的运行时和类型依赖验证。
- `scripts/architecture/resource-scope.check.mjs`：资源引用构造与来源失效信号的职责验证。
- `scripts/architecture/rules/command-boundary.mjs`：command 调用归属的唯一检查。
- `scripts/architecture/rules/docs-module-map.mjs`：模块文档标题、紧凑正文、参考路径、排序及索引对应的唯一检查。
- `scripts/architecture/rules/draft-session-boundary.mjs`：会话适配器、目标比较消费者及基础入口依赖方向的检查。
- `scripts/architecture/rules/frontend-layer-boundary.mjs`：前端层级、组件消费、wire 边界、service 依赖和运行时循环的检查。
- `scripts/architecture/rules/index.mjs`：正式规则及元规则注册表。
- `scripts/architecture/rules/parser-boundary.mjs`：工具资产、Mod JSON-like 与 CSV 解析职责。
- `scripts/architecture/rules/project-session-boundary.mjs`：正式清单写入、工作区选择归属与 Core 显式根输入的依赖检查。
- `scripts/architecture/rules/read-ticket-boundary.mjs`：读取票据、通道接纳与正式消费者检查。
- `scripts/architecture/rules/rust-project-layer-boundary.mjs`：Rust 内部分层、command payload 归属及 CSV 暂存的单向依赖检查。
- `scripts/architecture/rules/rust-service-edge-boundary.mjs`：Rust 顶层能力依赖的检查。
- `scripts/architecture/rules/save-backend-boundary.mjs`：各保存及历史 command 的正式后端依赖检查。
- `scripts/architecture/rules/write-boundary.mjs`：公开能力声明、操作权限和转导出来源的检查。
- `scripts/architecture/save-backend-boundary.check.mjs`：保存后端路由与所属请求类型的合法、越界验证。
- `scripts/architecture/schema-input-boundary.check.mjs`：字段分派器与专用输入组件的职责验收。
- `scripts/architecture/spec-template-boundary.check.mjs`：共享模板解析 与 Mod 格式解析边界验收。
- `scripts/architecture/workspace-input-boundary.check.mjs`：生产导航与共址输入测试角色的职责验收。
- `scripts/check-architecture.mjs`：仓库事实建立、规则执行和诊断输出入口。
- `scripts/check-encoding.mjs`：UTF-8 无 BOM 检查入口。
- `scripts/check-identifier-length.mjs`：变量与函数长度检查入口。
- `scripts/check-styles.mjs`：展示依赖、语法、声明与变量来源检查入口。
- `scripts/test-rust-paths.ps1`：Windows 长路径与实际 8.3 短路径的独立全测环境。
- `scripts/types/`：静态检查依赖的 AST 类型声明。

### 消费

- `scripts/shared/`：共享仓库事实、语义解析、能力矩阵及其测试。
- `scripts/shared/command-policy.mjs`：实际 command 装配 的契约。
- `scripts/shared/files.mjs`：仓库路径清单、源码读取和事实装配。
- `scripts/shared/frontend-policy.mjs`：层级、能力、正式 与诊断位置的共享契约。
- `scripts/shared/frontend-source.mjs`：TypeScript 与 Vue 脚本解析、绑定、转导出和源码位置。
- `scripts/shared/imports.check.mjs`：源码语义、实际路径、转导出和共享解析的行为测试。
- `scripts/shared/imports.mjs`：项目 alias、实际节点、去重模块边和符号来源。
- `scripts/shared/rust-crate-paths.mjs`：Rust 路径、服务直接导出、分组导入及局部别名的来源解析。
- `scripts/shared/rust-source.mjs`：Rust 注释、字面量与测试项过滤的正式入口。
- `scripts/shared/style-source.mjs`：展示源码解析、依赖图和可确定诊断的消费入口。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。

## 边界

- ESLint、编码、格式与标识符入口各自拥有诊断，CI 和本地共用正式命令。
- Rust 规则消费统一生产源码过滤和 crate 路径解析，模块分类按完整段判定。
- 共址测试和夹具按测试角色分类，规则行为由 Node 检查入口验收。
- 检查入口收集仓库文件并建立共享源码事实，规则消费解析后的绑定、节点、模块边和位置。
- 模块文档规则消费 module map、模块正文与共享仓库路径清单，拥有参考关系、目录归属冲突及索引对应诊断。
- 能力矩阵表达公开操作和正式消费者，command-policy 表达底层调用 owner。
- 规则注册表装配正式规则与元规则，同一依赖事实归唯一检查 owner。
- 通用规则拥有层级、组件、service 和循环检查，业务规则拥有独立领域契约。

## 链路

### 架构事实建立

1. 共享收集器建立仓库可用路径清单并读取适用源码、schema、配置和模块文档。
2. Vue 编译器提取普通脚本与 setup 脚本；TypeScript 编译器解析绑定、导出、动态导入和类型引用。
3. 项目 alias 与 base URL 配置解析为路径模式，导入指向实际存在的文件或目录入口。
4. 绑定按实际目标和类型属性聚合为模块边，同时保存绑定的原始名称、局部名称与源码位置。
5. 各源码对象携带解析后的导入、导出、模块边与依赖诊断进入规则注册表。

### 规则与诊断

1. 通用依赖规则验证层级、组件和 service 关系，并遍历前端生产源码的运行时与类型依赖图。
2. 能力规则验证公开声明，并沿具名、namespace、动态导入和转导出追踪正式能力来源。
3. 模块规则消费同一事实验证各自的业务契约；Rust 规则解析正式生产引用。
4. 检查入口聚合解析与规则诊断，失败时输出具体文件、位置、目标或符号及期望 owner。
5. 全部检查通过时输出通过信息，失败时返回非零退出码。

### 模块文档

1. 文档规则解析 module map 并核对磁盘文档。
2. 校验 H1、固定 H2 顺序、各章节紧凑正文及参考 H3 分组、链路 H3 连续编号。
3. 参考路径与完整文件和目录清单匹配，分组内路径排序，同篇路径保持唯一。
4. 公共清单与 shared 目录确定公共文件及共址测试，模块拥有声明覆盖公共文件时产生诊断。
5. 拥有目录展开到全部后代文件，跨模块的重复拥有进入归属冲突诊断。
6. 索引与模块目录文件按路径一一匹配，文档契约失败进入同一诊断出口。

### 本地与 CI 验证

1. lint 执行 ESLint。
2. Node 测试入口执行 shared 与 architecture 的全部 `*.check.mjs`。
3. 架构入口执行全部规则。
4. 展示入口独立检查全部展示源码和各自依赖图。
5. 标识符入口执行变量与函数长度检查。

## 规范

- CI 的 Rust 全测必须分别在长路径与实际 8.3 短路径的独立进程执行；测试入口必须核对别名解析一致性，并只允许清理自己建立且身份未变化的目录。
- ESLint 必须跳过受控审计目录、计划工作区、构建产物及生成目录，项目源码必须经正式规则检查。
- Rust 服务转导出必须解析到实际定义并沿用所属权限，局部别名和分组导入必须保持相同检查；会话根转导出必须完整参与层级检查。
- Rust 生产过滤必须分别消费分号声明与块状测试项，必须保留其后的生产引用。
- UI 规则必须依据共享控件的实际语义区分展示职责，职责约束必须在正式消费者和合成入口中验证。
- namespace 与通配转导出必须展开运行时能力；符号别名和转导出必须保留正式能力来源，显式导出必须拥有其名称。
- 公共文件必须消费公共清单及 shared 目录登记，严禁赋予模块拥有关系；共址测试必须继承公共属性。
- 前端循环检查必须消费统一解析后的运行时与类型依赖，生产源码必须保持无环。
- 动态导入必须使用可静态授权的字面量模块来源；类型引用必须参与类型边界并保持其类型属性。
- 参考必须按拥有、消费、装配、关联排列非空 H3 分组；组内必须使用紧凑路径列表，同篇路径必须唯一。
- 反馈工厂、窗口提供入口与恢复装配必须按实际路径授权；反馈展示与注入严禁依赖恢复业务。
- 受控能力入口的公开运行时导出必须声明能力及正式消费者；读取、订阅、项目失效和会话清理必须分别授权。
- 展示检查必须消费实际依赖图和解析结果；主题值与布局结果必须由所属行为测试和浏览器验证。
- 引擎消费者必须通过正式 renderer 绘制图层、解析颜色和创建静态成品，架构检查必须核对属性与下标颜色访问，并拒绝消费者中的独立效果图层与着色实现。
- 拥有目录必须覆盖全部后代文件，跨模块的拥有声明严禁重叠。
- 新约束必须覆盖合法与违规行为测试；命名、导入、转导出、重复诊断与真实入口必须通过正式测试命令验收。
- 混合导入必须逐绑定表达类型与运行时属性；模块边必须按调用文件、实际目标和属性去重。
- 窗口 session 关闭门控必须由工作区生命周期消费，关闭状态必须由窗口宿主提供，设置关闭 flush 必须由主窗口动作装配消费。
- 编码、格式、架构和标识符长度必须经各自正式入口检查，仓库遍历必须复用共享收集器。
- 能力规则必须依据公开声明及真实来源分别授权联合 command、交接、读取、聚焦和身份更新，fixture 必须验证正确 owner 与越界调用。
- 规则、授权矩阵和文档必须表达同一职责与接口契约，本地与 CI 必须使用同一验证入口。
- 规则只允许验证正式约束，严禁以函数或文件名称存在作为完成判据。
- 计划工作区只允许作为阶段产物保留在路径清单，严禁作为架构源码解析。
- 读取消费者必须经 `ReadTicket` owner 的 consume 回调发布结果、错误和收尾状态，接纳动作只允许消费正式票据协议。
- 通用层级与能力检查必须按实际节点角色判定；service 自身引用与已声明能力关系必须具有明确语义。
- 项目内部依赖必须解析为实际节点；缺失目标必须产生可定位错误。

## 陷阱

- 以省略的导入字符串代替实际节点会让 alias 与目录入口得到不同职责判断。
- 多个规则重复拥有同一事实会产生重复诊断并使授权归属分叉。
- 将查询或订阅归为状态写入会给只读消费者授予错误权限。
- 整条混合导入按类型分类会遗漏运行时依赖和循环。
- 用转导出或动态导入隐藏来源会使能力权限脱离实际实现符号。
