# 多窗口机制

## 定义

多窗口机制模块管理窗口身份、实例复用、跨窗口交接和关闭生命周期。

## 参考

### 拥有

- `src-tauri/capabilities/`：原生窗口可用能力授权。
- `src-tauri/src/commands/windows.rs`：以 Tauri 注入调用窗口绑定上下文、请求接纳与回执身份。
- `src-tauri/src/services/windows.rs`：原生窗口能力，拥有身份登记、创建复用、目标占用、实例交接与关闭等待。
- `src/app/composables/use-managed-window-requests.ts`：组件作用域内请求接纳及释放适配。
- `src/app/composables/use-window-close-state.ts`：窗口操作锁、具名关闭请求、内容参与登记和卸载释放。
- `src/app/composables/use-window-shortcuts.ts`：统一窗口按键监听、菜单优先、关闭屏蔽及卸载释放。
- `src/orchestrators/window-event-errors.orchestrator.ts`：窗口事件失败的统一反馈交接。
- `src/orchestrators/window-identity.orchestrator.ts`：已准备文件身份的预约和原生窗口身份交接。
- `src/orchestrators/window-target-focus.orchestrator.ts`：冲突目标、已加载路径与规格或文本窗口聚焦的动作。
- `src/services/window.service.ts`：窗口 command 的类型化签名与参数装配。
- `src/windows/current.window.ts`：当前窗口生命周期，提供关闭请求、关闭监听、最小化、最大化、拖拽、重载与显示。
- `src/windows/managed.window.ts`：请求交付，等待所属请求的终结回执。
- `src/windows/window-context.window.ts`：只读上下文、请求监听接纳及上下文版本的前端运行态。
- `src/windows/window.events.ts`：窗口关闭、请求可用与实例释放的协议事件名。

### 消费

- `src-tauri/src/models/window.rs`：规格、文本与恢复窗口的判别身份、Windows 路径比较键与生命周期消息。
- `src-tauri/src/services/project/session.rs`：会话打开、关闭、内容更新与内部登记及就绪访问能力交付。
- `src/domain/spec-editor/spec-editor-definitions.ts`：规格窗口名称、初始及最小尺寸的定义入口。
- `src/services/entity-query.service.ts`：四类查询定义、正式请求与实体失效选择。
- `src/shared/lib/keyboard-shortcuts.ts`：四种键盘命令及可编辑目标的公共纯规则。
- `src/shared/runtime/event.runtime.ts`：公共事件注册、载荷和错误交接，解除由窗口运行态持有。
- `src/shared/types/window.types.ts`：前端窗口输入、上下文与交付结果模型。

### 关联

- `src/shared/lib/paths.ts`：文件系统、资源及游戏目录的路径纯规则。
- `src/windows/spec-editor.window.ts`：四类规格的身份、尺寸与结构化窗口请求。
- `src/windows/text-editor.window.ts`：文本编辑器窗口请求，承载常规与错误恢复两种请求形状。

## 边界

- Rust 登记拥有原生 label 范围的身份、标题、最近接纳输入、最新待交付请求、递增版本与终结结果。
- 窗口事件名归窗口协议，公共运行时交付监听，窗口上下文及应用关闭参与者持有所属接纳、顺序和解除。
- 保存及身份编排消费原生登记、预约、聚焦和释放能力。
- 内容登记消费 dirty、等待及提示输入，持有参与句柄；应用运行执行关闭阶段和确认，窗口提供请求及操作锁。
- 前端上下文运行态拥有只读投影、通知监听及回执编排，业务 ViewModel 拥有输入转换和业务状态。
- 当前窗口 owner 提供关闭请求、重载和显示，原生销毁由应用生命周期协调。
- 窗口请求层装配身份、尺寸、标题与结构化输入，managed window 等待接收方回执。
- 类型化 identity 归窗口模型，Rust 拥有实例 label、目标占用、创建复用与关闭等待。
- 设置初始化与通知消费 Rust 设置服务的正式 snapshot。
- Windows WebView 在非活动状态使用低内存目标，获得焦点后恢复正常目标；首次隐藏创建交付后台目标。

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
6. Rust 在销毁前等待获准子窗口交付性能尾批；应用关闭还等待主窗口交付设置、日志和性能尾批。
7. Rust 销毁获准窗口并等待 Destroyed，释放登记及完整关闭的会话，交付实际结果。

### 主窗口保存事件协调

1. 窗口生命周期建立所属保存有序通道。
2. 项目同步按保存顺序交付完整结果。
3. 接收方完成正式清单、缓存、身份及内容接纳后交回完成结果。
4. 窗口卸载释放所属通道与接纳权。

## 规范

- Windows 辅助窗口必须拦截普通关闭指令，并保留运行时销毁能力。
- `sessionId`、kind 与实体 ID 必须按原值比较；Mod 与文件路径统一处理分隔符、大小写、尾部分隔符及扩展路径前缀。
- 会话关闭必须阻止新窗口登记；创建期间的关闭意图在实例构造完成后继续执行；重叠关闭等待前次完成并重新取得现存范围，全部确认先于销毁。
- 关闭、创建失败与动作取消必须释放所属登记及占用；生命周期等待按请求身份接纳完成或取消。
- 原生实例必须按 label 登记完整 `EditWriteTarget` 集合；目标查询核对 session、Mod 和物理路径范围，销毁及会话释放移除所属登记。
- 发起方关闭必须结束所属等待，子窗口继续拥有已登记输入；接收窗口销毁取消待交付请求并释放所属载荷。
- 已领取请求必须完整交付；后续待处理项只保留最新一项，被替换项返回 superseded；回执绑定 requestId 和 receiverGeneration。
- 当前上下文、请求接纳及失败报告必须由 Tauri 注入的调用窗口确定身份。
- 战机联队窗口结构化输入必须携带所属战机联队 `rowKey`；改名接纳由该行身份解析正式战机联队 ID，并将最新 rowKey 共同交付可重载上下文，原生身份继续消费 session、Mod、kind 与 ID。
- 打开或身份交接遇到已登记的 dirty、saving 或 creating 目标时，窗口能力必须先显示并聚焦占用实例，再返回稳定冲突错误。
- 沉浸式身份必须包含 session、Mod、`JointEditKind` 与 ID，并按正式 Windows 路径键比较；同实体的规格、文本与沉浸式窗口保留各自实例身份及共同物理协调范围。
- 窗口身份与编辑目标必须消费正式读取交付的规范路径；登记、聚焦、预约和重定向沿用该路径身份。
- 聚焦能力按完整 `WindowIdentity` 查询现有登记、显示窗口、恢复最小化并聚焦；找不到所属实例返回 `false`，调用方保留草稿与冲突诊断。
- 获准窗口必须在销毁前完成性能尾批交付；观测交付失败继续已确认的关闭。
- 规格、文本、CSV 关联和配置身份准备遇到目标已存在时，必须消费错误中的正式 target 聚焦所属实例，再报告原始冲突；配置列表的同 ID 拒绝消费所属已加载目标。
- 规格身份必须分别表达 `sessionId`、kind、`modRoot` 与 id；文本身份分别表达 `sessionId`、`modRoot` 与 path；恢复身份分别表达 nullable `modRoot` 与 path。
- 身份交接必须共同更新原生登记、可重载上下文、ViewModel 目标、标题与事件过滤；再次打开新身份复用已交接实例。
- 身份改名必须登记下一规格身份与文本路径占用；联合编辑的物理预约由保存准备完成后的目标集合提供，并保留已协调窗口。
- 代码编辑器身份必须以 session 与 Mod 根表达窗口，所属文件集合通过编辑目标登记参与保存、占用与关闭。
