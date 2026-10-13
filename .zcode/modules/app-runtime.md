# 应用启动与窗口挂载

## 定义

应用启动与窗口挂载模块负责初始化窗口依赖、挂载对应界面并呈现启动结果。

## 参考

`index.html`：`#app` 挂载点与启动错误呈现容器。
`src/app/App.vue`：主窗口根，以 main 模式包装唯一窗口壳并装配主窗口内容。
`src/app/EditorWindowApp.vue`：编辑器子窗口根，以 child 模式包装编辑器窗口内容。
`src/app/FileEditorApp.vue`：文件编辑器子窗口根，以 child 模式包装文件编辑器窗口内容。
`src/app/WindowShell.vue`：唯一窗口壳 owner，以 main/child 模式区分设置持久化与设置镜像，统一挂载 Provider、主题与 Core 加载生命周期。
`src/app/naive-ui.runtime.ts`：Naive UI 按需注册 owner。
`src/app/theme-overrides.ts`：Naive UI 主题覆盖构建 owner，消费主题令牌生成 provider 覆盖。
`src/assets/app-icon.svg`：标题栏透明罗盘图标资源。
`src/main.ts`：启动入口 owner，解析 URL 窗口类型、加载 settings、初始化 settings store、创建 Vue 与 Pinia、注册 Naive UI，并按窗口类型异步加载唯一窗口根。
`src/services/app-settings.service.ts`：启动消费的主窗口 settings 读取能力。

## 边界

- Naive UI 注册表拥有控件装配，非 Provider 控件在首次渲染时异步解析。
- URL 提供窗口身份输入，启动校验决定对应窗口根及错误呈现。
- main 拥有依赖初始化、根组件加载、Vue 挂载与窗口显示。
- 主窗口读取 settings，子窗口消费主窗口传入的完整 snapshot。
- 主题算法归设置领域，settings store 提供派生结果，窗口壳挂载唯一 DOM effect。
- 原生创建、复用与事件归窗口能力，启动入口消费已建立的身份参数。
- 启动失败由 `#app` 错误容器承载，显示能力使已创建窗口可见。
- 窗口壳装配 Provider、设置、主题、Core 和目标交接生命周期，主窗口内容由主窗口根注入。

## 链路

### 主窗口启动

1. `main.ts` 解析 URL 参数得到窗口类型；主窗口无 `window` 参数。
2. 显式装配性能日志 sink，并行异步加载主窗口根组件与 `loadSettings()`。
3. settings 校验通过后 `initializeSettingsStore(settings)` 写入初始快照。
4. 创建 Vue 应用并安装 Pinia 与 Naive UI 按需注册。
5. 挂载主窗口根；根以 main 模式装配唯一窗口壳。
6. 唯一窗口壳启动设置持久化、主题 DOM effect 与 Core 根监听。
7. `showCurrentWindow()` 显示窗口。

### 子窗口启动

1. `main.ts` 解析 `window` 参数得到编辑器、文件编辑器或沉浸式编辑器类型。
2. 从 URL 解析主窗口传入的 settings snapshot；缺失时抛出启动错误。
3. 显式装配性能日志 sink，并行异步加载对应子窗口根组件并解析 settings。
4. `initializeSettingsStore(snapshot)` 写入初始快照。
5. 创建 Vue 应用并挂载子窗口根；根以 child 模式装配唯一窗口壳并启动设置镜像。
6. `showCurrentWindow()` 显示窗口。

### 启动失败

1. `bootstrap()` 任一步骤抛错进入统一失败处理。
2. `#app` 内替换为启动错误呈现，输出转义后的错误消息。
3. 尽力调用显示窗口命令，保证用户能看到失败状态。

## 规范

- 主窗口与子窗口的模式差异必须由唯一窗口壳的 mode 参数表达，严禁出现第二份 Provider 栈。
- 启动失败必须经当前窗口显示能力呈现已创建窗口，原始失败消息必须由统一错误容器承载。
- 启动链路的控件注册必须显式登记，严禁通过副作用自动注册控件。
- 启动错误呈现必须 HTML 转义消息内容，严禁拼接未转义文本。
- 子窗口 settings snapshot 只允许从 URL 读取一次并经统一校验入口初始化，后续更新必须走设置镜像事件。
- 日志 sink 必须在业务挂载前显式装配，pagehide 必须撤销所属注册。
- 每个窗口壳必须建立一次 Core 加载生命周期，释放时必须撤销所属监听及响应接纳。
- 窗口根组件必须按窗口类型懒加载，严禁建立包含全部窗口根的公共入口模块。

## 陷阱

- 在子窗口读取 settings 文件会绕过主窗口的 settings 持久化权威。
- 把 Provider 栈复制进主窗口根或任一子窗口根会造成设置持久化与主题注入的双入口漂移。
- 把 URL 参数当作已校验业务数据直接消费会让非法身份进入业务链路。
- 用静态 import 引入全部窗口根会让任一窗口的启动 bundle 承载无关窗口代码。
