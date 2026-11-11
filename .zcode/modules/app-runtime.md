# 应用运行与窗口生命周期

## 定义

应用运行与窗口生命周期模块负责初始化窗口依赖、挂载对应界面并呈现启动结果。

## 参考

### 拥有

- `.nvmrc`：本地与 CI 共用的 Node 运行版本。
- `CONTRIBUTING.md`：项目开发环境与协作入口。
- `LICENSE`：项目许可文本。
- `README.md`：应用介绍、安装与使用入口。
- `build.bat`：Windows 发布命令入口。
- `build.ps1`：Windows 发布构建与验证入口。
- `index.html`：`#app` 挂载点与启动错误呈现容器。
- `package-lock.json`：前端依赖的固定解析结果。
- `package.json`：应用依赖及正式开发、检查和构建命令。
- `rust-toolchain.toml`：Rust 工具链版本。
- `scripts/sync-version.mjs`：从 package.json 同步 npm 锁文件与 Rust 主程序版本。
- `showcase/`：应用展示图标资产。
- `src-tauri/Cargo.lock`：原生依赖的固定解析结果。
- `src-tauri/Cargo.toml`：原生依赖、编译特性与 crate 配置。
- `src-tauri/build.rs`：Tauri 构建入口。
- `src-tauri/icons/`：原生应用图标资产。
- `src-tauri/src/commands/app_lifecycle.rs`：关闭与设置 IPC、目标占用后的关闭编排、启动交接及运行参数装配。
- `src-tauri/src/domain/mod.rs`：原生领域规则的模块登记。
- `src-tauri/src/lib.rs`：原生应用启动、插件、command、窗口事件与资源配置装配。
- `src-tauri/src/main.rs`：原生进程入口。
- `src-tauri/src/services/app_lifecycle.rs`：关闭范围、内容准备阶段、原生销毁确认及会话释放协调。
- `src-tauri/src/services/mod.rs`：原生服务模块登记及查询、资源、保存业务函数的直接导出装配。
- `src-tauri/tauri.conf.json`：应用标识、窗口与构建配置。
- `src/app/App.vue`：主窗口根，以 main 模式包装唯一窗口壳并装配主窗口内容。
- `src/app/AppContent.vue`：主窗口装配、设置来源切换接线、明确文档保存与快捷键登记、窗口级 CSV 关联确认，以及完整目标绑定的 CSV 和 JSON 页面懒挂载。
- `src/app/CodeEditorApp.vue`：代码编辑器独立窗口的主题壳与内容装配。
- `src/app/ImmersiveEditorApp.vue`：沉浸式子窗口根与统一窗口壳挂载。
- `src/app/ImmersiveEditorContent.vue`：四类沉浸式组件、共同会话及业务事件装配。
- `src/app/SpecEditorApp.vue`：编辑器子窗口根，以 child 模式包装编辑器窗口内容。
- `src/app/SpecEditorContent.vue`：四类规格组件、窗口会话、依赖与跨窗口动作装配。
- `src/app/StartupFailure.vue`：独立承载启动失败说明、诊断复制、重试及原生窗口动作。
- `src/app/TextEditorApp.vue`：文本编辑器子窗口根，以 child 模式包装文本编辑器窗口内容。
- `src/app/TitleBar.vue`：标题栏菜单登记及导航与窗口动作交接。
- `src/app/WeaponFirePreviewApp.vue`：独立开火预览窗口根，消费唯一 child 窗口壳。
- `src/app/WindowRuntime.vue`：窗口唯一反馈、关闭操作锁、菜单宿主的建立与提供，以及菜单和目标交接挂载。
- `src/app/WindowShell.vue`：唯一窗口壳，以 main/child 模式区分设置持久化与设置镜像，统一挂载 Provider、主题与 Core 加载生命周期。
- `src/app/app-feedback-assembly.ts`：文件会话定位、授权恢复动作、转码及保存同步。
- `src/app/components/AppImage.vue`：统一图片控件的等比展示与窗口关闭锁适配。
- `src/app/components/AppSelect.vue`：统一下拉框的展开状态、箭头收起与内部聚焦。
- `src/app/components/MainWindowFrame.vue`：主窗口空间及主内容区域的展示框架。
- `src/app/components/WindowTooltip.vue`：窗口统一接管原生 title 提示，持有悬浮等待、主题展示与释放。
- `src/app/composables/immersive-editor-assembly.ts`：舰船、皮肤、武器、联队和装配的实现选择、会话交接及展示媒体适配。
- `src/app/composables/joint-editor-validation.ts`：联合来源图与候选内容的字段、整表、规格及装配检查装配。
- `src/app/composables/spec-editor-assembly.ts`：Spec 查询定义与依赖实现选择。
- `src/app/composables/use-app-close-participant.ts`：应用关闭六阶段、业务动作注入、保存等待、确认和恢复。
- `src/app/composables/use-app-lifecycle-assembly.ts`：窗口关闭、参与者工厂、菜单宿主、项目展示准备、设置提交与编辑历史容量装配。
- `src/app/global-components.d.ts`：模板全局组件与项目包装组件的类型契约，和运行注册共同维护。
- `src/app/naive-ui.runtime.ts`：Naive UI 按需注册。
- `src/app/theme-overrides.ts`：Naive UI 主题覆盖构建，消费主题令牌生成 provider 覆盖。
- `src/assets/app-icon.svg`：标题栏透明罗盘图标资源。
- `src/main.ts`：启动入口，消费原生上下文窗口类型、加载 settings、初始化 settings store、创建 Vue 与 Pinia、注册 Naive UI，并按窗口类型异步加载唯一窗口根。
- `src/services/app-lifecycle.service.ts`：关闭范围、阶段回复与启动就绪的类型化 IPC。
- `tsconfig.base.json`：共同严格检查与逐文件转换约束。
- `tsconfig.browser-scripts.json`：Node 浏览器自动化与页面类型配置。
- `tsconfig.json`：应用与浏览器预览的 TypeScript 编译及路径配置。
- `tsconfig.node.json`：Vite 配置加载环境的 TypeScript 配置。
- `tsconfig.scripts.json`：Node 工程脚本与 ESLint 配置的 TypeScript 配置。
- `tsconfig.test.json`：Vitest 与 jsdom 单元测试的 TypeScript 配置。
- `vite.config.ts`：前端构建、alias、测试与版本常量装配。

### 消费

- `src-tauri/src/services/app_log.rs`：日志运行参数及目录准备与已有目录解析能力。
- `src-tauri/src/services/app_log/directory.rs`：日志目录创建、已有目录解析、规范路径与传入工作区根的保护规则。
- `src-tauri/src/services/app_settings.rs`：正式快照、revision、串行写盘、目录回调结果接纳及装配传入的运行参数提交动作。
- `src-tauri/src/services/code_editor.rs`：代码编辑窗口销毁后的队列与回执释放。
- `src-tauri/src/services/file_history/records.rs`：按实际 Mod 根持有 changeset、双栈、revision、容量及回放交接。
- `src-tauri/src/services/java_analysis.rs`：Java 分析运行态初始化及应用关闭后的实例释放。
- `src-tauri/src/services/java_analysis/editor.rs`：代码窗口销毁后的分析项目释放。
- `src-tauri/src/services/performance_monitor.rs`：命令计时、环形缓冲与报告导出。
- `src-tauri/src/services/project/resources/media_cache.rs`：正式设置接纳时配置后端媒体预算。
- `src-tauri/src/services/project/session.rs`：会话打开、关闭、内容更新与内部登记及就绪访问能力交付。
- `src-tauri/src/services/project_sync.rs`：项目保存队列、完整会话释放、结果发布和未完成工作寿命。
- `src-tauri/src/services/project_sync/source_changes.rs`：根订阅角色与寿命、来源状态、合并批次、后台排队及 Core 分发。
- `src-tauri/src/services/windows.rs`：原生窗口能力，拥有身份登记、创建复用、目标占用、实例交接与关闭等待。
- `src-tauri/src/services/workspace_persistence.rs`：单次目录操作捕获的已持久化工作区物理根。
- `src/app/TextEditorContent.vue`：窗口内容，拥有行号槽、文本域、快捷键与外部文本呈现。
- `src/app/WeaponFirePreviewContent.vue`：加载状态、稳定预览实例与关闭动作的装配入口。
- `src/app/app-feedback.ts`：提示、确认、诊断日志及文件动作展示。
- `src/app/application-log.ts`：窗口停写监听和 Pinia 动作记录装配。
- `src/app/components/ContextMenu.vue`：窗口运行范围内唯一挂载的菜单。
- `src/app/components/ModNavigation.vue`：当前 Mod 的页面与业务导航。
- `src/app/components/ModTabsBar.vue`：Mod 页签选择与移除动作展示。
- `src/app/components/ProjectSyncNotice.vue`：所属未完成交接的显示。
- `src/app/components/code-editor/CodeEditorContent.vue`：代码编辑器的多文件窗口内容。
- `src/app/components/immersive/ImmersiveEditorActions.vue`：共同保存、撤销及外部载入动作展示。
- `src/app/components/immersive/ImmersiveEditorShell.vue`：共同标题、来源、状态与业务插槽。
- `src/app/components/immersive/immersive-render-context.ts`：只读与编辑展示契约。
- `src/app/components/immersive/ship/ShipImmersivePanel.vue`：舰船内容与静态贴图展示组件。
- `src/app/components/immersive/variant/VariantImmersivePanel.vue`：装配、候选、插件及武器组交互组件。
- `src/app/components/immersive/weapon/WeaponImmersivePanel.vue`：武器内容与弹体及开火预览事件入口。
- `src/app/components/immersive/wing/WingImmersivePanel.vue`：战机联队内容及来源字段展示。
- `src/app/components/java-analysis/JavaAnalysisCard.vue`：设置页 Java 组件管理的前端消费者，由主窗口装配。
- `src/app/components/spec-editor/projectile/SpecProjectileEditor.vue`：弹体画布、检查器与行为测试。
- `src/app/components/spec-editor/ship/SpecShipEditor.vue`：舰船画布、检查器与行为测试。
- `src/app/components/spec-editor/system/SpecSystemEditor.vue`：系统表单展示与事件绑定入口。
- `src/app/components/spec-editor/weapon/SpecWeaponEditor.vue`：武器画布、检查器与行为测试。
- `src/app/composables/csv-editor/csv-associated-spec-selection.ts`：CSV 查询、输入、动作装配与保存参与者。
- `src/app/composables/field-editor/use-field-edit-mode.ts`：来源读取、路径选择、输入模式、行身份及选项媒体寿命。
- `src/app/composables/immersive-editor/use-immersive-editor-runtime.ts`：联合会话、历史、字段与关联读取运行态。
- `src/app/composables/immersive-editor/variant/use-immersive-variant-editor.ts`：装配动作、确认、在途状态及动作历史。
- `src/app/composables/immersive-editor/weapon/use-immersive-weapon-editor.ts`：分支覆盖、弹体及开火预览动作。
- `src/app/composables/immersive-editor/wing/use-immersive-wing-editor.ts`：按 rowKey 读取、来源补全、身份跟随及关联编辑器打开。
- `src/app/composables/settings/use-theme-dom-effect.ts`：主题与字体 DOM 副作用，写 root dataset、颜色变量与字体变量。
- `src/app/composables/spec-editor/spec-editor.types.ts`：目标、响应式输入及规格定义契约。
- `src/app/composables/spec-editor/spec-schema-context.ts`：所属规格目标的字段来源上下文交付。
- `src/app/composables/spec-editor/use-spec-editor-draft-images.ts`：草稿图像读取及接纳。
- `src/app/composables/spec-editor/use-spec-editor-window-view-model.ts`：四类规格目标会话、保存、身份与外部基线接纳。
- `src/app/composables/spec-editor/use-spec-problems.ts`：会话问题聚合、原文优先级、失败保留及共享展示。
- `src/app/composables/spec-editor/weapon/use-spec-weapon-editor-dependencies.ts`：武器字段、发射点动作、光效与资源依赖生命周期。
- `src/app/composables/use-app-feedback.ts`：窗口反馈的提供与消费入口。
- `src/app/composables/use-context-menu.ts`：菜单所需的 ContextMenuHost 输入契约。
- `src/app/composables/use-core-assets.ts`：图形门面与显式根输入的窗口生命周期。
- `src/app/composables/use-edit-target-handoff.ts`：窗口接收与目标登记生命周期。
- `src/app/composables/use-main-window-shortcuts.ts`：主窗口保存与工作区历史命令装配。
- `src/app/composables/use-managed-window-requests.ts`：组件作用域内请求接纳及释放适配。
- `src/app/composables/use-mod-navigation-panel.ts`：Mod 导航面板的宽窄布局、展开、焦点和监听释放。
- `src/app/composables/use-original-fonts.ts`：窗口字体运行态、读取票据、逐项接纳、日志与响应式测量。
- `src/app/composables/use-window-close-state.ts`：窗口操作锁、具名关闭请求、内容参与登记和卸载释放。
- `src/app/composables/use-window-image-runtime.ts`：窗口图片、成品、代次、引用与预读并发。
- `src/app/composables/use-window-shortcuts.ts`：统一窗口按键监听、菜单优先、关闭屏蔽及卸载释放。
- `src/app/composables/use-workspace-csv-editor-host.ts`：当前 CSV 完整目标、有效游戏根、持久列宽与实体定位交接。
- `src/app/composables/use-workspace-json-editor-host.ts`：工作区 JSON 页面目标及定位与导航宿主。
- `src/app/composables/use-workspace-navigation-actions.ts`：导航输入提交、保存等待和存活草稿交接。
- `src/app/composables/use-workspace-shell-actions.ts`：主窗口工作区动作及绑定当前窗口关闭能力的来源切换。
- `src/app/composables/use-workspace-shell-lifecycle.ts`：主窗口恢复、工作区持久化及保存事件生命周期。
- `src/app/performance-monitor.ts`：窗口采集装配、批量交付与采集错误状态。
- `src/app/runtime-error-monitor.ts`：窗口和 Vue 运行错误的监听、上下文及结构化日志接入。
- `src/domain/csv-editor/`：表格字段检查、来源上下文与关联规格的纯规则。
- `src/domain/editors/weapon-spec.ts`：武器创建、CSV 字段分支推断、归一化与分支转换。
- `src/domain/immersive/appearance.ts`：沉浸式缩放、主题与颜色投影。
- `src/domain/immersive/fields.ts`：字段规则、数值投影与具名关联查询输入契约。
- `src/domain/immersive/ship/ship-panel.ts`：舰船来源、后勤、战斗、装备投影及系统与防御关联查询输入投影。
- `src/domain/immersive/source-records.ts`：可编辑来源与装配记录选择。
- `src/domain/immersive/variant/variant-panel.ts`：装备与船体投影及武器组、模块、联队和插件的关联查询输入投影。
- `src/domain/immersive/weapon/weapon-panel.ts`：武器字段、说明、图标来源、分支投影及弹体与贴图关联查询输入投影。
- `src/domain/immersive/wing/wing-panel.ts`：技术信息、来源绑定与编队输入投影。
- `src/domain/joint-edit.ts`：联合写入范围提取、身份映射、草稿重接与冲突选择投影。
- `src/domain/json-composition.ts`：前端内容组合、来源定位、稀疏编辑及覆盖撤销。
- `src/domain/schema/`：字段与列资产加载、游戏数字解释、来源声明、校验及目标格式准备。
- `src/domain/settings/theme.ts`：主题令牌与色彩数学，拥有 accent 预设、light/dark 中性色、`createThemeColors` 纯函数及 `THEME_TOKEN_MAP` 的 ThemeColorTokens 与主题属性映射。
- `src/domain/spec-editor/projectile/`：弹体字段、分支与几何模型的纯规则。
- `src/domain/spec-editor/ship/`：舰船字段、文档、几何与内置武器的纯规则。
- `src/domain/spec-editor/system/spec-system-fields.ts`：系统结构化字段与规格归一化。
- `src/domain/spec-editor/weapon/spec-weapon-fields.ts`：发射点动作、镜像及操作预览规则。
- `src/env.d.ts`：启动诊断消费的公共构建版本声明。
- `src/orchestrators/file-history-replay.orchestrator.ts`：明确目标的历史摘要刷新、回放计划、复核、执行及实际结果交付。
- `src/orchestrators/mod-save.orchestrator.ts`：所属窗口的 Mod 保存协调实例与结果交付。
- `src/orchestrators/project-sync.orchestrator.ts`：窗口内保存消费过程和内容维护者交接。
- `src/orchestrators/settings-persistence.orchestrator.ts`：设置持久化与镜像，负责保存、接收快照及已提交设置的装配回调。
- `src/orchestrators/window-event-errors.orchestrator.ts`：窗口事件失败的统一反馈交接。
- `src/orchestrators/workspace-lifecycle.orchestrator.ts`：生命周期，拥有关闭目标捕获、所属模块清理用例与工作区关闭。
- `src/services/app-settings.service.ts`：启动消费的主窗口 settings 读取能力。
- `src/services/csv-table.service.ts`：窗口、行预览、资源装配和关联实际目标准备。
- `src/services/joint-edit.service.ts`：三个 command 的类型化协议装配。
- `src/services/spec-projectile-editor.service.ts`：弹体编辑数据与草稿图像的独立查询。
- `src/services/spec-ship-editor.service.ts`：舰船规格、草稿贴图及内置武器来源的查询入口。
- `src/services/spec-system-editor.service.ts`：战术系统规格与实际目标的查询入口。
- `src/services/spec-weapon-editor.service.ts`：武器编辑数据、贴图和弹体选项目录的查询入口。
- `src/services/text-editor.service.ts`：文本读取、身份交接、保存与转码的 IPC 参数装配。
- `src/services/window.service.ts`：窗口 command 的类型化签名与参数装配。
- `src/stores/csv-editor.store.ts`：窗口装配消费的历史容量正式输入入口。
- `src/stores/draft-sessions.store.ts`：未保存工作注册表，按 `modRoot` 聚合会话登记与判定源。
- `src/stores/json-editor.store.ts`：文档登记、每 session 类型选择记忆及当前文档动作。
- `src/stores/project-sync.store.ts`：当前待办、错误和项目等待状态。
- `src/stores/project.store.ts`：按 Mod 根管理全部 manifest、session 查询、表格写入目标与正式清单。
- `src/stores/save-command.store.ts`：菜单宿主绑定的本窗口保存等待。
- `src/stores/settings.store.ts`：窗口装配消费的当前编辑历史偏好。
- `src/stores/workspace.store.ts`：当前 Mod、正式清单与 session 的工作区派生投影。
- `src/test/unit/ui-stubs.ts`：应用测试的 Naive UI 控件装配。
- `src/windows/current.window.ts`：当前窗口生命周期，提供关闭请求、关闭监听、最小化、最大化、拖拽、重载与显示。
- `src/windows/spec-editor.window.ts`：四类规格的身份、尺寸与结构化窗口请求。
- `src/windows/text-editor.window.ts`：消费完整文件请求并交付常规与恢复模式窗口身份。
- `src/windows/weapon-fire-preview.window.ts`：完整预览身份、来源、标题与尺寸的请求入口。
- `src/windows/window-context.window.ts`：启动消费的原生 bootstrap、上下文与正式设置交接入口。
- `src/windows/window.events.ts`：窗口关闭、请求可用与实例释放的协议事件名。

### 关联

- `src-tauri/src/models/mod.rs`：模型登记及聚合导出。
- `src-tauri/src/test_support.rs`：Rust 测试的目录、环境及链接构造。
- `src/shared/types/index.ts`：业务 wire 契约的聚合转导出入口。

## 边界

- Naive UI 注册表同步装配 Provider 与 NButton，其余控件在首次渲染时异步解析。
- main 拥有依赖初始化、根组件加载、Vue 挂载与窗口显示。
- 主题算法归设置领域，settings store 提供派生结果，窗口壳挂载唯一 DOM effect。
- 主窗口消费所属工作区动作中的来源切换能力，经设置页向设置持久化交付同一动作。
- 全部窗口从 Rust 设置服务读取正式 snapshot，主窗口装配唯一编辑提交队列。
- 原生设置运行参数装配向项目同步交付 `watchFileChanges`，由来源监听应用实际启停。
- 原生 bootstrap 提供窗口种类、已接纳上下文和接收代次，启动入口独立装配设置与所属根。
- 原生创建、复用与事件归窗口能力，启动入口消费已建立的身份参数。
- 原生启动为已建立窗口设置后台内存目标，窗口焦点事件向窗口能力交付交互状态。
- 启动失败由 `#app` 错误容器承载，显示能力使已创建窗口可见。
- 窗口壳装配 Provider、设置、主题、Core、窗口图片运行态和目标交接生命周期，主窗口内容由主窗口根注入。
- 窗口反馈装配向反馈工厂交付当前设置的提示时长读取函数，每条提示独立捕获其创建时的时长。

## 链路

### 构建版本同步

1. build、build:demo 与 npm version 执行同一版本同步脚本，读取 package.json 的 version。
2. 同步脚本准备 npm 锁文件两处版本及 Rust 主程序清单、锁文件版本，并写入变化的文件。
3. Vite 将 package.json 版本注入 `__APP_VERSION__`，Tauri 配置经 `../package.json` 读取应用版本，Rust 经 `CARGO_PKG_VERSION` 读取主程序版本。

### 主窗口启动

1. main.ts 经 IPC 读取 bootstrap，main 种类进入主窗口装配。
2. 并行异步加载主窗口根组件与 `initializeSettings()`。
3. settings 校验通过后 `initializeSettingsStore(settings)` 写入初始快照。
4. 创建 Pinia、装配日志故障监听与动作记录，按本次运行有效开关装配性能监视，再创建 Vue 应用并安装 Naive UI 按需注册。
5. 挂载主窗口根；根以 main 模式装配唯一窗口壳。
6. 唯一窗口壳启动设置持久化、主题 DOM effect 与 Core 根监听。
7. `showCurrentWindow()` 显示窗口。

### 子窗口启动

1. main.ts 经 IPC 取得调用窗口的上下文及接收代次，独立读取设置服务正式快照。
2. 按 editor、text-editor、immersive-editor 或 weapon-fire-preview 种类异步加载对应根。
3. initializeSettingsStore 接纳完整快照，创建 Vue 应用与 Pinia。
4. 根组件挂载唯一 child 窗口壳，设置镜像监听后读取最新版本。
5. 内容挂载所属请求接纳运行态并完成业务输入交接。
6. showCurrentWindow 显示所属窗口。

### 启动失败

1. `bootstrap()` 任一步骤抛错进入统一失败处理。
2. 启动失败经当前窗口 IPC 结束待交付请求并保留诊断。
3. 已挂载应用先卸载，`#app` 挂载独立失败页面，诊断按文本呈现。
4. 尽力调用显示窗口命令，保证用户能看到失败状态。

### 关闭与恢复

1. 窗口内容向窗口登记能力交付 dirty、范围、等待和反馈文字，应用装配提供完整参与者工厂。
2. 参与者按 hold、settle、prepare、confirm、flush、resume 执行，等待保存、复核内容并交付所属尾批。
3. Rust 销毁获准窗口并调用项目同步释放，存活窗口先接纳 releasedSessions 再恢复读取及焦点。
4. 内容卸载通过窗口登记释放参与句柄，应用装配释放所属同步订阅。

## 规范

- 应用版本必须以 package.json 的 version 为唯一维护来源，构建与 npm version 同步 npm 锁文件及 Rust 主程序版本。
- Java 分析必须在应用初始化时登记惰性运行态，应用确认关闭后等待所属实例释放。
- 关闭确认必须按实际关闭范围筛选未保存参与者并展开对象及全部路径；退出、关闭与 Esc 保留原编辑状态并沿所属关闭恢复流程交还焦点。
- 启动入口必须在页面释放时结束接纳权，上下文、窗口根与设置、日志等待后的挂载、显示及失败呈现服从该寿命。
- 主窗口与子窗口共用一套 Provider 栈，模式差异由唯一窗口壳的 mode 参数表达。
- 全部窗口 settings snapshot 必须从 Rust 设置服务读取并经统一校验入口初始化，后续更新先监听再读取正式快照并按版本接纳。
- 启动失败页面必须提供重试、复制诊断和退出，提供原生窗口控制；退出等待启动失败交接并消费现有关闭流程，展示独立于 settings、业务 store 和 Provider 初始化。
- 应用关闭必须先完成主窗口确认和设置提交，再逐个销毁子窗口与独立恢复窗口、释放会话并最后销毁主窗口。
- 每个窗口壳必须建立一次 Core 加载生命周期，释放时撤销所属监听及响应接纳。
- 窗口 Core 根必须消费后端按所属会话或工作区确定的实际来源，由唯一 Core 加载生命周期交付给字段、图形与提示过滤。
- 窗口操作锁由 WindowRuntime 提供；内容区域消费 inert，业务浮层消费关闭状态的声明式命名空间，确认与结果反馈由所属窗口的 Provider 承载。
- 窗口根组件由各自入口按窗口类型懒加载。
- 设置 IPC 由应用装配连接设置服务、日志目录动作与运行参数 owner；正式提交顺序由设置服务独占。
- 自定义日志目录操作必须先捕获同次持久化根集合再交付目录能力；存在工作区快照时每次准备或解析只读取该快照一次，默认目录读取零次，重复正式设置读取复用初始化结果。
