# 应用启动与窗口挂载

## 定义

应用启动与窗口挂载模块负责初始化窗口依赖、挂载对应界面并呈现启动结果。

## 参考

`index.html`：`#app` 挂载点与启动错误呈现容器。
`src/app/App.vue`：主窗口根，以 main 模式包装唯一窗口壳并装配主窗口内容。
`src/app/FileEditorApp.vue`：文件编辑器子窗口根，以 child 模式包装文件编辑器窗口内容。
`src/app/SpecEditorApp.vue`：编辑器子窗口根，以 child 模式包装编辑器窗口内容。
`src/app/WeaponFirePreviewApp.vue`：独立开火预览窗口根，消费唯一 child 窗口壳。
`src/app/WindowShell.vue`：唯一窗口壳 owner，以 main/child 模式区分设置持久化与设置镜像，统一挂载 Provider、主题与 Core 加载生命周期。
`src/app/composables/immersive-editor-assembly.ts`：沉浸式实现选择、会话交接及展示协议适配。
`src/app/composables/spec-editor-assembly.ts`：Spec 查询定义与依赖实现选择。
`src/app/naive-ui.runtime.ts`：Naive UI 按需注册 owner。
`src/app/theme-overrides.ts`：Naive UI 主题覆盖构建 owner，消费主题令牌生成 provider 覆盖。
`src/assets/app-icon.svg`：标题栏透明罗盘图标资源。
`src/main.ts`：启动入口 owner，消费原生上下文窗口类型、加载 settings、初始化 settings store、创建 Vue 与 Pinia、注册 Naive UI，并按窗口类型异步加载唯一窗口根。
`src/services/app-settings.service.ts`：启动消费的主窗口 settings 读取能力。
`src/windows/window-context.window.ts`：启动消费的原生 bootstrap、上下文与正式设置交接入口。

## 边界

- Naive UI 注册表拥有控件装配，非 Provider 控件在首次渲染时异步解析。
- main 拥有依赖初始化、根组件加载、Vue 挂载与窗口显示。
- 主窗口读取 settings，子窗口消费主窗口传入的完整 snapshot。
- 主题算法归设置领域，settings store 提供派生结果，窗口壳挂载唯一 DOM effect。
- 原生 bootstrap 提供窗口种类、上下文及 settings，启动入口装配所属根与错误呈现。
- 原生创建、复用与事件归窗口能力，启动入口消费已建立的身份参数。
- 启动失败由 `#app` 错误容器承载，显示能力使已创建窗口可见。
- 窗口壳装配 Provider、设置、主题、Core、窗口图片运行态和目标交接生命周期，主窗口内容由主窗口根注入。

## 链路

### 主窗口启动

1. main.ts 经 IPC 读取 bootstrap，main 种类进入主窗口装配。
2. 显式装配性能日志 sink，并行异步加载主窗口根组件与 `loadSettings()`。
3. settings 校验通过后 `initializeSettingsStore(settings)` 写入初始快照。
4. 创建 Vue 应用与 Pinia，发布完整正式 settings snapshot 并安装 Naive UI 按需注册。
5. 挂载主窗口根；根以 main 模式装配唯一窗口壳。
6. 唯一窗口壳启动设置持久化、主题 DOM effect 与 Core 根监听。
7. `showCurrentWindow()` 显示窗口。

### 子窗口启动

1. main.ts 经 IPC 取得调用窗口的上下文及最新正式 settings snapshot。
2. 按 editor、file-editor、immersive-editor 或 weapon-fire-preview 种类异步加载对应根。
3. initializeSettingsStore 接纳完整快照，创建 Vue 应用与 Pinia。
4. 根组件挂载唯一 child 窗口壳，设置镜像监听后读取最新版本。
5. 内容挂载所属请求接纳运行态并完成业务输入交接。
6. showCurrentWindow 显示所属窗口。

### 启动失败

1. `bootstrap()` 任一步骤抛错进入统一失败处理。
2. 启动失败经当前窗口 IPC 结束待交付请求并保留诊断。
3. `#app` 内替换为启动错误呈现，输出转义后的错误消息。
4. 尽力调用显示窗口命令，保证用户能看到失败状态。

## 规范

- 主窗口与子窗口的模式差异必须由唯一窗口壳的 mode 参数表达，严禁出现第二份 Provider 栈。
- 启动失败必须经当前窗口显示能力呈现已创建窗口，原始失败消息必须由统一错误容器承载。
- 启动链路的控件注册必须显式登记，严禁通过副作用自动注册控件。
- 启动错误呈现必须 HTML 转义消息内容，严禁拼接未转义文本。
- 子窗口 settings snapshot 必须从原生 bootstrap 读取并经统一校验入口初始化，后续更新必须先监听再读取正式快照并按版本接纳。
- 日志 sink 必须在业务挂载前显式装配，pagehide 必须撤销所属注册。
- 每个窗口壳必须建立一次 Core 加载生命周期，释放时必须撤销所属监听及响应接纳。
- 每个窗口壳必须装配统一菜单，业务根必须通过登记接口交付身份与刷新回调。
- 窗口根组件必须按窗口类型懒加载，严禁建立包含全部窗口根的公共入口模块。

## 陷阱

- 在子窗口读取 settings 文件会绕过主窗口的 settings 持久化权威。
- 把 Provider 栈复制进主窗口根或任一子窗口根会造成设置持久化与主题注入的双入口漂移。
- 把窗口种类与业务身份分散解析会使窗口根及业务输入错配。
- 用静态 import 引入全部窗口根会让任一窗口的启动 bundle 承载无关窗口代码。
