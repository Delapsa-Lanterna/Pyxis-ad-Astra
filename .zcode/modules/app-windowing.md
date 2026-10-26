# 多窗口机制

## 定义

多窗口机制模块管理窗口身份、实例复用、跨窗口交接和关闭生命周期。

## 参考

### 拥有

- `src-tauri/capabilities/`：原生窗口可用能力授权。
- `src-tauri/src/commands/windows.rs`：以 Tauri 注入调用窗口绑定上下文、请求接纳与回执身份。
- `src-tauri/src/services/windows.rs`：原生窗口能力，拥有身份登记、创建复用、目标占用、实例交接与关闭等待。
- `src/app/composables/use-dirty-window-close-guard.ts`：窗口内容准备、稳定摘要、所属确认及阶段回复。
- `src/app/composables/use-managed-window-requests.ts`：组件作用域内请求接纳及释放适配。
- `src/app/composables/use-window-close-state.ts`：窗口关闭操作锁与装配动作的提供和消费。
- `src/orchestrators/entity-identity.orchestrator.ts`：规格身份占用与原生窗口身份交接。
- `src/orchestrators/window-event-errors.orchestrator.ts`：窗口事件失败的统一反馈交接。
- `src/orchestrators/window-target-focus.orchestrator.ts`：冲突目标、已加载路径与规格或文本窗口聚焦的动作。
- `src/services/window.service.ts`：窗口 command 的类型化签名与参数装配。
- `src/windows/current.window.ts`：当前窗口生命周期，提供关闭请求、关闭监听、最小化、最大化、拖拽、重载与显示。
- `src/windows/managed.window.ts`：请求交付，等待所属请求的终结回执。
- `src/windows/tauri.events.ts`：跨窗口事件监听与发送封装。
- `src/windows/window-context.window.ts`：只读上下文、请求监听接纳及设置版本的前端运行态。
- `src/windows/window.events.ts`：窗口事件名与 payload 类型。

### 消费

- `src-tauri/src/models/window.rs`：规格、文本与恢复窗口的判别身份、Windows 路径比较键与生命周期消息。
- `src/domain/spec-editor/spec-editor-definitions.ts`：规格窗口名称、初始及最小尺寸的定义入口。
- `src/orchestrators/edit-target-handoff.orchestrator.ts`：消费原生登记、预约与释放能力，协调联合目标准备。
- `src/shared/types/window.types.ts`：前端窗口输入、上下文与交付结果模型。
- `src/windows/file-editor.window.ts`：文件编辑器窗口请求，承载常规与错误恢复两种请求形状。
- `src/windows/spec-editor.window.ts`：四类规格的身份、尺寸与结构化窗口请求。

### 关联

- `src/shared/lib/paths.ts`：文件系统、资源及游戏目录的路径纯规则。

## 边界

- Rust 登记拥有原生 label 范围的身份、标题、最近接纳输入、最新待交付请求、递增版本与终结结果。
- 事件注册表拥有事件名与 payload，监听入口拥有接纳、错误交付和卸载释放。
- 保存及身份编排消费原生登记、预约、聚焦和释放能力。
- 关闭守卫消费会话与活动输入的聚合 dirty，并拥有同一关闭意图的等待与确认。
- 前端上下文运行态拥有只读投影、通知监听及回执编排，业务 ViewModel 拥有输入转换和业务状态。
- 当前窗口 owner 提供关闭请求、重载和显示，原生销毁由应用生命周期协调。
- 窗口请求层装配身份、尺寸、标题与结构化输入，managed window 等待接收方回执。
- 类型化 identity 归窗口模型，Rust 拥有实例 label、目标占用、创建复用与关闭等待。
- 设置初始化与通知消费 Rust 设置服务的正式 snapshot。

## 链路

### 创建与复用

1. 业务动作捕获完整 identity、标题、所属结构化输入和尺寸，调用 managed window。
2. Rust 校验授权及种类，登记最新请求并为同一身份创建或复用原生实例。
3. 新实例以固定应用入口启动；已有实例接收定向请求通知并显示聚焦。
4. 接收方先监听通知，再原子领取当前请求，等待所属业务 owner 的异步接纳。
5. 接收方按 requestId 和接收代次返回 accepted 或结构化失败，较早待处理项返回 superseded。
6. 发起动作等待所属终结结果并经正式反馈入口呈现错误。

### 重载与设置

1. 当前调用窗口通过 IPC 读取已接纳上下文及新的接收代次。
2. 启动入口按窗口种类挂载对应根，业务内容消费身份与最近接纳输入。
3. 请求运行态先恢复已接纳业务，再原子领取未完成请求。
4. 设置镜像先注册通知，再读取最新版本并整体接纳。

### 关闭 dirty 窗口

1. 用户触发标题栏关闭、窗口关闭按钮或 Escape。
2. 关闭守卫在关闭请求上立即 `preventDefault`，避免原生 close-requested 阻塞 GUI 线程。
3. 守卫等待已登记保存并重试所属待同步提交，失败或取消结束本次意图。
4. 成功后重新读取 dirty，存在未保存状态时等待放弃确认。
5. Rust 生命周期按 window、sessions 或 application 范围协调全部参与窗口。
6. Rust 销毁获准窗口并等待 Destroyed，释放登记及完整关闭的会话，交付实际结果。

### 主窗口保存事件协调

1. 主窗口工作区动作启动时注册保存事件监听。
2. 同步编排接纳当前窗口 receipt 并发送完整提交事件。
3. 共享监听入口接纳历史和投影、按身份与代次失效缓存，完成身份交接后投影所属规格和文本。
4. 窗口卸载时释放全部监听。

## 规范

- Windows 辅助窗口必须拦截普通关闭指令，并保留运行时销毁能力。
- dirty 或 saving 关闭必须立即 preventDefault，并在保存与同步结束后核对最新 dirty；重复关闭必须合并同一意图，取消或失败必须保留窗口。
- `sessionId`、kind 与实体 ID 必须按原值比较；Mod 与文件路径必须统一处理分隔符、大小写、尾部分隔符及扩展路径前缀。
- 会话关闭必须阻止新窗口登记；创建期间的关闭意图必须在实例构造完成后继续执行；重叠关闭必须等待前次完成并重新取得现存范围，全部确认必须先于销毁。
- 保存与回放通知必须共用 `committedWriteApplied`，事件必须携带 `originWindowLabel`、`modRoot`、nullable `sessionId`、reason 与完整 `WriteResult`。
- 全部窗口必须经设置服务读取正式 snapshot 并按 revision 接纳。
- 关闭、创建失败与动作取消必须释放所属登记及占用；生命周期等待必须按请求身份接纳完成或取消。
- 关闭期间必须暂停所属窗口的内容操作、快捷键及菜单；销毁前必须复核捕获的目标、草稿与活动输入，新增未授权变化必须结束本次关闭。
- 关闭范围必须由调用窗口与捕获的 session 集合共同标识；session 门控必须记录所属调用窗口，取消、失败、动作结束和发起窗口销毁必须释放所属门控及等待。
- 原生 label 必须由应用内登记序号产生，并且必须在业务身份交接时保持稳定。
- 原生实例必须按 label 登记完整 `EditWriteTarget` 集合；目标查询必须核对 session、Mod 和物理路径范围，销毁及会话释放必须移除所属登记。
- 原生身份交接必须共同更新标题、当前身份及最近接纳输入，重载必须读取完整可用上下文。
- 发起方关闭必须结束所属等待，子窗口必须继续拥有已登记输入；接收窗口销毁必须取消待交付请求并释放所属载荷。
- 同一 session、Mod 与提交身份的进行中通知必须复用同一派发 Promise；等待身份接纳后必须核对所属 session 和订阅生命周期。
- 已领取请求必须完整交付；后续待处理项必须只保留最新一项，被替换项必须返回 superseded；回执必须绑定 requestId 和 receiverGeneration。
- 广播重试必须复用实际 receipt 及完成进度；事件处理失败必须归所属错误 owner，发送成功必须以 Tauri 事件发送结果判定。
- 当前上下文、请求接纳及失败报告必须由 Tauri 注入的调用窗口确定身份。
- 当前窗口回声必须按来源 label 过滤，重复提交必须按根和提交序号去重；身份消费者必须先取得接纳意图，依赖投影消费者必须等待该动作。
- 战机联队窗口结构化输入必须携带所属战机联队 `rowKey`；改名接纳必须由该行身份解析正式战机联队 ID，并将最新 rowKey 共同交付可重载上下文，原生身份必须继续消费 session、Mod、kind 与 ID。
- 打开成功必须以所属业务基线或预览数据加载成功及输入接纳判定；展示资源必须沿所属读取生命周期独立加载。
- 打开或身份交接遇到已登记的 dirty、saving 或 creating 目标时，窗口能力必须先显示并聚焦占用实例，再返回稳定冲突错误。
- 提交接收必须先接纳权威投影并失效资源与查询缓存，再启动身份读取；投影消费者必须等待身份交接完成。
- 沉浸式窗口必须消费固定暗色原生主题；保存与外部改名必须共同更新登记、可重载上下文、标题、联合记录键和历史身份。
- 沉浸式身份必须包含 session、Mod、`JointEditKind` 与 ID，并按正式 Windows 路径键比较；同实体的规格、文本与沉浸式窗口必须保留各自实例身份及共同物理协调范围。
- 窗口创建必须以隐藏方式启动，由内容就绪后显式显示。
- 窗口请求必须按所属种类声明初始和最小尺寸；内容必须消费实际容器完成重排，尺寸装配必须归正式窗口请求层。
- 窗口身份与编辑目标必须消费正式读取交付的规范路径；登记、聚焦、预约和重定向必须沿用该路径身份。
- 聚焦能力必须按完整 `WindowIdentity` 查询现有登记、显示窗口、恢复最小化并聚焦；找不到所属实例必须返回 `false`，调用方必须保留草稿与冲突诊断。
- 规格、文本、CSV 关联和配置身份准备遇到目标已存在时，必须消费错误中的正式 target 聚焦所属实例，再报告原始冲突；配置列表的同 ID 拒绝必须消费所属已加载目标。
- 规格身份必须分别表达 `sessionId`、kind、`modRoot` 与 id；文本身份必须分别表达 `sessionId`、`modRoot` 与 path；恢复身份必须分别表达 nullable `modRoot` 与 path。
- 跨窗口事件必须使用事件名注册表的常量，严禁裸字符串事件名。
- 身份交接必须共同更新原生登记、可重载上下文、ViewModel 目标、标题与事件过滤；再次打开新身份必须复用已交接实例。
- 身份改名必须登记下一规格身份与文本路径占用；联合编辑的物理预约必须由保存准备完成后的目标集合提供，并保留已协调窗口。
- 重载当前窗口必须走当前窗口生命周期 owner，与实现保持同一命名。

## 陷阱

- 关闭确认后重新发起 `close` 会再次触发关闭请求形成循环。
- 创建子窗口后不等待创建结果会让失败静默成为白屏窗口。
- 把失败反馈写进窗口层会让窗口层反向依赖用户反馈 store。
- 直接用业务字符串拼接窗口 label 会让不同目标的窗口互相复用。
- 绕过关闭守卫直接监听关闭事件会让 dirty 状态在未确认时丢失。
