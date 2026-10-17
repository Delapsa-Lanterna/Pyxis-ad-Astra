# 应用启动与窗口挂载

## 定义

应用启动与窗口挂载模块负责初始化窗口依赖、挂载对应界面并呈现启动结果。

## 参考

### 拥有

- `.nvmrc`：Node 运行版本。
- `CONTRIBUTING.md`：项目开发环境与协作入口。
- `LICENSE`：项目许可文本。
- `README.md`：应用介绍、安装与使用入口。
- `build.bat`：Windows 发布命令入口。
- `build.ps1`：Windows 发布构建与验证入口。
- `index.html`：`#app` 挂载点与启动错误呈现容器。
- `package-lock.json`：前端依赖的固定解析结果。
- `package.json`：应用依赖及正式开发、检查和构建命令。
- `rust-toolchain.toml`：Rust 工具链版本。
- `showcase/`：应用展示图标资产。
- `src-tauri/Cargo.lock`：原生依赖的固定解析结果。
- `src-tauri/Cargo.toml`：原生依赖、编译特性与 crate 配置。
- `src-tauri/build.rs`：Tauri 构建入口。
- `src-tauri/icons/`：原生应用图标资产。
- `src-tauri/src/commands/app_lifecycle.rs`：关闭与设置 IPC、目标占用后的关闭编排、启动交接、运行参数与配置清理装配。
- `src-tauri/src/domain/mod.rs`：原生领域规则的模块登记。
- `src-tauri/src/lib.rs`：原生应用启动、插件、command、窗口事件与资源配置装配。
- `src-tauri/src/main.rs`：原生进程入口。
- `src-tauri/src/services/app_lifecycle.rs`：关闭范围、内容准备阶段、原生销毁确认及会话释放协调。
- `src-tauri/src/services/mod.rs`：原生服务模块登记及查询、资源、保存业务函数的直接导出装配。
- `src-tauri/tauri.conf.json`：应用标识、窗口与构建配置。
- `src/app/App.vue`：主窗口根，以 main 模式包装唯一窗口壳并装配主窗口内容。
- `src/app/AppContent.vue`：主窗口装配入口，注册活动保存目标与窗口快捷键。
- `src/app/FileEditorApp.vue`：文件编辑器子窗口根，以 child 模式包装文件编辑器窗口内容。
- `src/app/ImmersiveEditorApp.vue`：沉浸式子窗口根与统一窗口壳挂载。
- `src/app/ImmersiveEditorContent.vue`：四类沉浸式组件、共同会话及业务事件装配。
- `src/app/SpecEditorApp.vue`：编辑器子窗口根，以 child 模式包装编辑器窗口内容。
- `src/app/SpecEditorContent.vue`：四类规格组件、窗口会话、依赖与跨窗口动作装配。
- `src/app/TitleBar.vue`：标题栏菜单登记及导航与窗口动作交接。
- `src/app/WeaponFirePreviewApp.vue`：独立开火预览窗口根，消费唯一 child 窗口壳。
- `src/app/WindowRuntime.vue`：窗口唯一反馈、关闭操作锁的建立与提供，以及目标交接挂载。
- `src/app/WindowShell.vue`：唯一窗口壳，以 main/child 模式区分设置持久化与设置镜像，统一挂载 Provider、主题与 Core 加载生命周期。
- `src/app/app-feedback-assembly.ts`：文件会话定位、授权恢复动作、转码及保存同步。
- `src/app/composables/immersive-editor-assembly.ts`：沉浸式实现选择、会话交接及展示协议适配。
- `src/app/composables/spec-editor-assembly.ts`：Spec 查询定义与依赖实现选择。
- `src/app/composables/use-app-lifecycle-assembly.ts`：窗口关闭、项目展示准备、设置提交及配置清理动作装配。
- `src/app/naive-ui.runtime.ts`：Naive UI 按需注册。
- `src/app/theme-overrides.ts`：Naive UI 主题覆盖构建，消费主题令牌生成 provider 覆盖。
- `src/assets/app-icon.svg`：标题栏透明罗盘图标资源。
- `src/env.d.ts`：Vite 环境及构建常量的声明入口。
- `src/main.ts`：启动入口，消费原生上下文窗口类型、加载 settings、初始化 settings store、创建 Vue 与 Pinia、注册 Naive UI，并按窗口类型异步加载唯一窗口根。
- `src/services/app-lifecycle.service.ts`：关闭范围、阶段回复与启动就绪的类型化 IPC。
- `tsconfig.json`：应用 TypeScript 编译与路径配置。
- `tsconfig.node.json`：工程脚本 TypeScript 编译配置。
- `vite.config.ts`：前端构建、alias、测试与版本常量装配。

### 消费

- `src/services/app-settings.service.ts`：启动消费的主窗口 settings 读取能力。
- `src/stores/workspace.store.ts`：当前 Mod、正式清单与 session 的工作区派生投影。
- `src/test/stubs.ts`：应用测试的共享组件装配。
- `src/test/ui-stubs.ts`：应用测试的 Naive UI 控件装配。
- `src/windows/window-context.window.ts`：启动消费的原生 bootstrap、上下文与正式设置交接入口。

### 关联

- `src-tauri/src/models/mod.rs`：模型导出及 serde 字段转换。
- `src-tauri/src/testutil.rs`：Rust 测试的目录、环境及链接构造。
- `src/shared/types/index.ts`：业务 wire 契约的聚合转导出入口。

## 边界

- Naive UI 注册表拥有控件装配，非 Provider 控件在首次渲染时异步解析。
- main 拥有依赖初始化、根组件加载、Vue 挂载与窗口显示。
- 主题算法归设置领域，settings store 提供派生结果，窗口壳挂载唯一 DOM effect。
- 全部窗口从 Rust 设置服务读取正式 snapshot，主窗口装配唯一编辑提交队列。
- 原生 bootstrap 提供窗口种类、已接纳上下文和接收代次，启动入口独立装配设置与所属根。
- 原生创建、复用与事件归窗口能力，启动入口消费已建立的身份参数。
- 启动失败由 `#app` 错误容器承载，显示能力使已创建窗口可见。
- 窗口壳装配 Provider、设置、主题、Core、窗口图片运行态和目标交接生命周期，主窗口内容由主窗口根注入。

## 链路

### 主窗口启动

1. main.ts 经 IPC 读取 bootstrap，main 种类进入主窗口装配。
2. 显式装配性能日志 sink，并行异步加载主窗口根组件与 `initializeSettings()`。
3. settings 校验通过后 `initializeSettingsStore(settings)` 写入初始快照。
4. 创建 Vue 应用与 Pinia，安装 Naive UI 按需注册。
5. 挂载主窗口根；根以 main 模式装配唯一窗口壳。
6. 唯一窗口壳启动设置持久化、主题 DOM effect 与 Core 根监听。
7. `showCurrentWindow()` 显示窗口。

### 子窗口启动

1. main.ts 经 IPC 取得调用窗口的上下文及接收代次，独立读取设置服务正式快照。
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
- 全部窗口 settings snapshot 必须从 Rust 设置服务读取并经统一校验入口初始化，后续更新必须先监听再读取正式快照并按版本接纳。
- 关闭取消必须保留实际销毁及完整释放结果，存活 owner 必须恢复准备状态、焦点和保留的读取失效。
- 关闭必须由 Rust 应用生命周期协调范围、准备回复、销毁等待与会话释放；窗口模块必须交付实例与原生事件，项目会话必须交付会话释放，工作区必须消费实际释放结果。
- 启动失败必须经当前窗口显示能力呈现已创建窗口，原始失败消息必须由统一错误容器承载。
- 启动链路的控件注册必须显式登记，严禁通过副作用自动注册控件。
- 启动错误呈现必须 HTML 转义消息内容，严禁拼接未转义文本。
- 应用关闭必须先完成主窗口确认和设置提交，再逐个销毁子窗口与独立恢复窗口、释放会话并最后销毁主窗口。
- 文件恢复必须在提示产生时捕获所属文件与会话；转码写盘后的同步失败必须保留原提交和待同步重试。
- 日志 sink 必须在业务挂载前显式装配，pagehide 必须撤销所属注册。
- 每个窗口壳必须建立一次 Core 加载生命周期，释放时必须撤销所属监听及响应接纳。
- 每个窗口壳必须装配统一菜单，业务根必须通过登记接口交付身份与刷新回调。
- 窗口 Core 根必须按设置根、当前项目清单根、空根的顺序计算，并交付唯一 Core 加载生命周期。
- 窗口反馈必须在消息与对话框 Provider 内建立一次，并先于菜单及业务内容提供；目标交接必须消费同一实例。
- 窗口操作锁必须由 WindowRuntime 提供；内容区域必须消费 inert，业务浮层必须消费关闭状态的声明式命名空间，确认与结果反馈必须由所属窗口的 Provider 承载。
- 窗口根组件必须按窗口类型懒加载，严禁建立包含全部窗口根的公共入口模块。
- 设置 IPC 必须由应用装配连接设置服务与运行参数 owner；正式提交顺序必须由设置服务独占。

## 陷阱

- 把 Provider 栈复制进主窗口根或任一子窗口根会造成设置持久化与主题注入的双入口漂移。
- 把窗口种类与业务身份分散解析会使窗口根及业务输入错配。
- 用静态 import 引入全部窗口根会让任一窗口的启动 bundle 承载无关窗口代码。
- 设置接纳必须消费 Rust 正式快照及 revision。
