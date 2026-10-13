# 静态检查系统

## 定义

静态检查模块验证仓库的结构、格式和模块职责契约。

## 参考

`scripts/architecture/capability-boundary.check.mjs`：能力授权、规则归属和真实仓库入口的行为测试。
`scripts/architecture/command-boundary.check.mjs`：command 来源、词法作用域与 owner 验收。
`scripts/architecture/docs-module-map.check.mjs`：模块文档严格格式、参考路径与索引对应的行为测试。
`scripts/architecture/rules/command-boundary.mjs`：command 调用归属的唯一检查 owner。
`scripts/architecture/rules/css-token-boundary.mjs`：CSS token 定义、引用、主题覆盖和共享圆角/阴影语义的检查 owner。
`scripts/architecture/rules/docs-module-map.mjs`：模块文档标题、紧凑正文、参考路径、排序及索引对应的唯一检查 owner。
`scripts/architecture/rules/frontend-layer-boundary.mjs`：前端层级、组件消费、wire 边界、service 依赖和运行时循环的检查 owner。
`scripts/architecture/rules/index.mjs`：正式规则及元规则注册表。
`scripts/architecture/rules/parser-boundary.mjs`：工具资产、Mod JSON-like 与 CSV 解析职责 owner。
`scripts/architecture/rules/read-ticket-boundary.mjs`：读取票据、通道接纳与正式消费者检查 owner。
`scripts/architecture/rules/rust-project-layer-boundary.mjs`：Rust 内部分层和 command payload 归属的检查 owner。
`scripts/architecture/rules/rust-service-edge-boundary.mjs`：Rust 顶层能力依赖的检查 owner。
`scripts/architecture/rules/write-boundary.mjs`：公开能力声明、操作权限和转导出来源的检查 owner。
`scripts/architecture/schema-input-boundary.check.mjs`：字段分派器与专用输入组件的职责验收。
`scripts/architecture/spec-template-boundary.check.mjs`：共享模板解析 owner 与 Mod 格式解析边界验收。
`scripts/architecture/workspace-input-boundary.check.mjs`：生产导航与共址输入测试角色的职责验收。
`scripts/check-architecture.mjs`：仓库事实建立、规则执行和诊断输出入口。
`scripts/check-encoding.mjs`：UTF-8 无 BOM 检查入口。
`scripts/check-identifier-length.mjs`：变量与函数长度检查入口。
`scripts/shared/command-policy.mjs`：实际 command 装配 owner 的契约。
`scripts/shared/files.mjs`：仓库路径清单、源码读取和事实装配 owner。
`scripts/shared/frontend-policy.mjs`：层级、能力、正式 owner 与诊断位置的共享契约。
`scripts/shared/frontend-source.mjs`：TypeScript 与 Vue 脚本解析、绑定、转导出和源码位置 owner。
`scripts/shared/imports.check.mjs`：源码语义、实际路径、转导出和共享解析的行为测试。
`scripts/shared/imports.mjs`：项目 alias、实际节点、去重模块边和符号来源 owner。
`scripts/shared/rust-crate-paths.mjs`：Rust crate、super、self 路径解析与去重 owner。

## 边界

- CSS 规则消费结构化 AST、主题定义、局部作用域与精确 allowlist。
- ESLint、编码、格式与标识符入口各自拥有诊断，CI 和本地共用正式命令。
- Rust 规则消费统一生产源码过滤和 crate 路径解析，模块分类按完整段判定。
- 共址测试和夹具按测试角色分类，规则行为由 Node 检查入口验收。
- 检查入口收集仓库文件并建立共享源码事实，规则消费解析后的绑定、节点、模块边和位置。
- 模块文档规则消费 module map、模块正文与共享仓库路径清单，拥有严格格式、参考路径及索引对应诊断。
- 能力矩阵表达公开操作和正式消费者，command-policy 表达底层调用 owner。
- 规则注册表装配正式规则与元规则，同一依赖事实归唯一检查 owner。
- 通用规则拥有层级、组件、wire、service 和循环检查，业务规则拥有独立领域契约。

## 链路

### 架构事实建立

1. 共享收集器建立仓库可用路径清单并读取适用源码、schema、配置和模块文档。
2. Vue 编译器提取普通脚本与 setup 脚本；TypeScript 编译器解析绑定、导出、动态导入和类型引用。
3. 项目 alias 与 base URL 配置解析为路径模式，导入指向实际存在的文件或目录入口。
4. 绑定按实际目标和类型属性聚合为模块边，同时保存绑定的原始名称、局部名称与源码位置。
5. 各源码对象携带解析后的导入、导出、模块边与依赖诊断进入规则注册表。

### 规则与诊断

1. 通用依赖规则验证层级、组件、wire、service 关系，并遍历 orchestrator 运行时图。
2. 能力规则验证公开声明，并沿具名、namespace、动态导入和转导出追踪正式能力来源。
3. 模块规则消费同一事实验证各自的业务契约；Rust 规则解析正式生产引用。
4. 检查入口聚合解析与规则诊断，失败时输出具体文件、位置、目标或符号及期望 owner。
5. 全部检查通过时输出通过信息，失败时返回非零退出码。

### 模块文档

1. 文档规则解析 module map 并核对磁盘文档。
2. 校验 H1、固定 H2 顺序、各章节紧凑正文及链路 H3 的连续编号。
3. 参考路径与完整文件和目录清单匹配，参考记录与无序条目分别按所属字典序比较。
4. 索引与模块目录文件按路径一一匹配，文档契约失败进入同一诊断出口。

### 本地与 CI 验证

1. lint 执行 ESLint。
2. Node 测试入口执行 shared 与 architecture 的全部 `*.check.mjs`。
3. 架构入口执行全部规则。
4. 标识符入口执行变量与函数长度检查。

## 规范

- CSS 授权必须精确表达文件、选择器、属性和值；局部授权必须保持其他作用域的检查，fixture 必须同时验收合法消费者和越界行为。
- UI 规则必须依据共享控件的实际语义区分展示职责，职责约束必须在正式消费者和合成入口中验证。
- namespace 与通配转导出必须展开运行时能力；符号别名和转导出必须保留正式能力来源，显式导出必须拥有其名称。
- orchestrator 循环必须使用统一运行时模块边；类型边只允许参与类型边界检查。
- 动态导入必须使用可静态授权的字面量模块来源；类型引用必须参与类型边界并保持其类型属性。
- 受控能力入口的公开运行时导出必须声明能力及正式消费者；读取、订阅、项目失效和会话清理必须分别授权。
- 新约束必须覆盖合法与违规行为测试；命名、导入、转导出、重复诊断与真实入口必须通过正式测试命令验收。
- 混合导入必须逐绑定表达类型与运行时属性；模块边必须按调用文件、实际目标和属性去重。
- 编码、格式、架构和标识符长度必须经各自正式入口检查，仓库遍历必须复用共享收集器。
- 能力规则必须依据公开声明及真实来源分别授权联合 command、交接、读取、聚焦和身份更新，fixture 必须验证正确 owner 与越界调用。
- 规则、授权矩阵和文档必须表达同一职责与接口契约，本地与 CI 必须使用同一验证入口。
- 规则只允许验证正式约束，严禁以函数或文件名称存在作为完成判据。
- 读取消费者必须经 `ReadTicket` owner 的 consume 回调发布结果、错误和收尾状态，接纳动作只允许消费正式票据协议。
- 通用层级与能力检查必须按实际节点角色判定；service 自身引用与已声明能力关系必须具有明确语义。
- 项目内部依赖必须解析为实际节点；缺失目标必须产生可定位错误。

## 陷阱

- 以省略的导入字符串代替实际节点会让 alias 与目录入口得到不同职责判断。
- 多个规则重复拥有同一事实会产生重复诊断并使授权归属分叉。
- 将查询或订阅归为状态写入会给只读消费者授予错误权限。
- 整条混合导入按类型分类会遗漏运行时依赖和循环。
- 用转导出或动态导入隐藏来源会使能力权限脱离实际实现符号。
