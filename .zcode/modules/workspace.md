# 工作区运行态与持久化

## 定义

工作区模块管理已加载 Mod、页面上下文和工作区恢复。

## 参考

### 拥有

- `src-tauri/src/commands/workspace_persistence.rs`：工作区快照加载与保存 command。
- `src-tauri/src/services/workspace_persistence.rs`：工具私有快照读写与现存持久化工作区物理根查询。
- `src/app/components/LoadedModsPanel.vue`：已载入 Mod 及工作区动作展示。
- `src/app/components/ModNavigation.vue`：当前 Mod 的页面与业务导航。
- `src/app/components/ModTabsBar.vue`：Mod 页签选择与移除动作展示。
- `src/app/components/OverviewPage.vue`：工作区概览、已载入 Mod 与游戏扫描组合。
- `src/app/components/workspace/WorkspaceFileHistory.vue`：当前 Mod 的历史摘要、双栈及回放动作展示。
- `src/app/components/workspace/WorkspaceGameOverview.vue`：游戏概览与当前工作区 Mod 状态、导航及用户动作。
- `src/app/components/workspace/WorkspaceModOverview.vue`：Mod 信息、目录、资源和数据摘要展示。
- `src/app/composables/use-main-window-shortcuts.ts`：主窗口保存与工作区历史命令装配。
- `src/app/composables/use-mod-navigation-panel.ts`：Mod 导航面板的宽窄布局、展开、焦点和监听释放。
- `src/app/composables/use-workspace-csv-editor-host.ts`：当前 CSV 完整目标、有效游戏根、持久列宽与实体定位交接。
- `src/app/composables/use-workspace-file-history-view-model.ts`：工作区历史页的读取寿命、菜单、确认及用户动作。
- `src/app/composables/use-workspace-json-editor-host.ts`：当前 JSON 页面目标、定位完成回执及已解析基础船体的导航交接。
- `src/app/composables/use-workspace-mod-creation.ts`：总览创建目的地、对话框状态及创建结果的工作区接纳。
- `src/app/composables/use-workspace-navigation-actions.ts`：导航输入提交、保存等待和存活草稿交接。
- `src/app/composables/use-workspace-shell-actions.ts`：主窗口工作区动作、当前窗口关闭与来源切换绑定、打开结果及失败反馈。
- `src/app/composables/use-workspace-shell-lifecycle.ts`：主窗口恢复、工作区持久化及保存事件生命周期。
- `src/domain/workspace/mod-navigation.ts`：每个 Mod 的页面状态与导航投影。
- `src/domain/workspace/mod-overview.ts`：正式 manifest 的 Mod 概览统计投影。
- `src/domain/workspace/mod-status.ts`：Mod 展示状态的纯投影。
- `src/domain/workspace/project-kind.ts`：正式项目清单的 Core 身份判断。
- `src/orchestrators/workspace-core-source.orchestrator.ts`：原版来源切换，拥有关闭、设置提交交接、Mod 重开及最终快照的完整等待。
- `src/orchestrators/workspace-history.orchestrator.ts`：当前编辑面草稿历史选择、文件回放确认与展示交接。
- `src/orchestrators/workspace-lifecycle.orchestrator.ts`：生命周期，拥有关闭目标捕获、所属模块清理用例与工作区关闭。
- `src/orchestrators/workspace-navigation.orchestrator.ts`：页签与页面导航，同步跨 store 运行态。
- `src/orchestrators/workspace-opening.orchestrator.ts`：工作区目录识别分流、Mod 打开代次、清单接纳、编辑初始化及失败清理。
- `src/orchestrators/workspace-persistence.orchestrator.ts`：workspace 快照保存与启动恢复。
- `src/services/workspace-state.service.ts`：workspace 持久化签名与协议装配。
- `src/stores/workspace.store.ts`：运行态，拥有当前 Mod、当前清单与 session 投影、全局页、Mod 页面上下文、概览、打开失败状态、列宽与持久化投影。

### 消费

- `src-tauri/src/app_data_dir.rs`：工作区快照持久化的工具私有目录解析。
- `src-tauri/src/models/workspace_persistence.rs`：工作区持久化 wire 契约。
- `src/app/composables/json-editor/json-editor-context.ts`：JSON 页面所需的目标、定位输入及具体宿主动作契约。
- `src/app/composables/use-window-shortcuts.ts`：窗口键盘监听、命中路由及关闭屏蔽。
- `src/orchestrators/file-history-replay.orchestrator.ts`：明确目标的回放计划、复核及实际结果。
- `src/orchestrators/mod-creation.orchestrator.ts`：最小 Mod 骨架的实际创建结果。
- `src/services/directory.service.ts`：目录识别与游戏概览扫描结果。
- `src/shared/types/workspace-persistence.types.ts`：工作区保存请求、目录、Mod、扫描结果及列宽快照。
- `src/shared/types/workspace.types.ts`：工作区页面与 Mod 导航契约。
- `src/stores/project.store.ts`：按 Mod 根查询正式清单与 session，当前项目投影消费原清单引用。

### 关联

- `scripts/architecture/rules/modules/workspace/workspace-module-boundary.mjs`：workspace 边界规则。

## 边界

- 持久化根查询从单次快照交付现存 Mod 与游戏目录的规范路径，日志目录保护决策归日志模块。
- JSON 会话与 CSV 提供未保存判定，导航及关闭消费所属输入和保存句柄。
- JSON 文档运行态归所属模块，工作区宿主持有当前页面目标的只读投影、定位完成及基础船体导航动作。
- Mod 概览、文件历史和 JSON 编辑使用独立工作区视图，业务侧栏消费各自导航目标。
- Core 概览与 Mod 概览共用正式概览投影；Core 身份消费实际游戏根与 Core 根的路径对应关系。
- Mod 页面上下文、概览与打开失败状态归本次运行，列宽和目录进入恢复快照。
- workspace store 拥有全局视图、Mod 页签、运行代次、页面上下文、概览、失败记录与列宽。
- 工作区按已就绪标签顺序生成会话序列，并从同一序列派生可引用来源，经项目同步统一发布。
- 启动恢复重建 session 与运行态并保留用户当前页面，初始引导界面随工作区数据接纳显示总览。
- 导航编排按 Mod 根同步 project、tables、editor 和 history 运行态，并恢复所属页面。
- 持久化编排投影可恢复数据，Rust service 读写工具私有 workspace 文件。
- 文件浏览器模块拥有按 session 隔离的目录树与浏览状态，工作区拥有 file-browser 页面及项目页面记忆。
- 生命周期编排消费 Rust 实际释放结果，拥有所属 Mod 清理和前端缓存释放。
- 没有游戏概览时，原版条目随最后一个普通 Mod 共同进入关闭范围；会话按实际释放结果清理，加载中条目在关闭成功后撤销接纳权。
- 启动恢复以游戏目录或普通 Mod 为工作区依据；仅含原版条目且没有游戏目录的快照结束为空工作区，并由恢复收尾保存当前快照。
- 工作区打开动作持有捕获代次、共享 manifest 等待及迟到 session 清理，接纳成功建立的运行态。
- 来源切换拥有捕获的恢复快照及完整关闭等待；主窗口装配交付当前关闭动作，设置模块交付正式设置提交闭包。
- 历史命令消费当前可见编辑面的草稿动作，文件回放确认与 CSV 选择交接归工作区动作。

## 链路

### 加载 Mod 进入运行态

1. 工作区打开动作消费目录识别结果并建立 ProjectSession。
2. workspace 注册已加载 Mod 条目并激活目标页面。
3. 导航编排按 `modRoot` 同步 project/tables/editor/history 运行态。

### 移除 Mod

1. 用户发起移除；所属待同步提交完成后，dirty 经确认放弃。
2. 生命周期编排按会话请求所属子窗口等待保存并处理关闭。
3. 交接完成后执行所属模块清理用例并撤销目标 Mod 代次。
4. Rust 完成会话释放，前端在恢复展示和读取前按 releasedSessions 清理所属运行态与缓存。
5. 页签移除后按存活页签决定回退视图。

### 关闭工作区

1. 用户发起关闭；捕获关闭目标内的全部 dirty 并逐项确认。
2. Rust 稳定会话范围并完成全部窗口确认，再统一销毁，前端清理实际释放的 Mod。
3. 按捕获的游戏根批量失效核心缓存。
4. 清空概览与失败状态，未保留活动 Mod 时显示总览。

### 启动恢复

1. 启动时读取工具私有快照。
2. 恢复接纳游戏概览和 Core 根，重新打开仍属于该代次的 session 并水合运行态。
3. 恢复期间自动保存暂停；恢复结束后按所属窗口存活状态决定最终持久化，关闭等待覆盖最终保存及所属反馈。

### 原版来源切换

1. 主窗口的工作区动作实例捕获当前窗口关闭请求，设置持久化经该实例的 switchCoreSource 交付目标覆盖根及设置提交闭包。
2. 来源切换等待已登记动作及目录打开，验证目标根并捕获工作区快照，暂停自动保存。
3. 正式关闭流程接纳实际释放结果；取消或错误登记并等待最终快照收尾。
4. 关闭成功后登记完整任务，执行设置提交，并在结束时按捕获列表恢复工作区。
5. 单 Mod 重开错误等待所属移除动作后登记，完整任务在最终快照处理后结束。

### 持久化保存

1. 页签变化、列宽变化或加载列表变化触发投影保存。
2. 编排把目录、Mod 列表与列宽投影写入工具私有快照。

## 规范

- 已持久化工作区根查询必须在单次操作内读取一次现存快照并交付其现存记录根；严禁将结果表达为全部活跃会话范围。
- 同路径 JSON 组合查询必须消费引用来源层交付的有序来源，原版始终可引用，当前 Mod 只允许接纳前序可引用 Mod 的已保存内容。
- 工作区创建必须在提交时捕获工作区代次；实际创建结果独立交付，创建后的打开服从原工作区的接纳权。
- 创建后的打开必须以新加载结果判定成功；已加载冲突及打开失败交付所属窗口反馈，取消保留实际创建结果。
- loading 条目与 Mod 代次必须先于 session 请求登记；相同工作区、根、来源和代次的 manifest 请求共享所属等待。
- manifest 登记、编辑初始化与失败清理必须服从发起代次；移除或关闭后到达的 session 经正式关闭入口释放。
- CSV 与 JSON 历史动作必须分别返回已处理、输入拒绝或草稿耗尽；只有草稿耗尽才允许进入文件历史。
- 工作区历史动作必须捕获 Mod、session、页面、当前表及 JSON 页面；输入提交后的目标变化结束本次草稿分派。
- 新打开的 Mod 必须默认自动引用；自动状态按全部已就绪 Mod 正式清单的依赖 ID 匹配已就绪来源，全部已打开 Mod 共用按标签顺序排列的可引用来源。
- 引用设置必须以 `referenceable` 的 `true` 表示手动开启、`false` 表示手动关闭、字段缺省表示自动；手动设置优先于自动结果，保存只写入手动值，恢复按正式清单派生实际状态并保留标签顺序。
- 标签右键必须操作命中的 Mod，拖动在放下时提交顺序并保留当前页面、草稿和会话身份。
- Mod 标签菜单必须按引用开关、手动设置存在时的恢复自动引用、分隔线、刷新的顺序展示；引用开关按实际状态写入手动值，恢复自动引用移除手动值；标签刷新读取该 Mod 信息、data 和 graphics，标签栏空白刷新只读取实际 Mod 标签的名称和版本。
- 工作区刷新必须复用总览刷新入口并更新游戏扫描和已打开项目，原版图标刷新按有效游戏根更新关联项目与原版来源；全部刷新保留页面、草稿、标签身份和顺序。
- 原版来源切换必须捕获游戏目录、Mod 列表与列宽，并复用正式关闭及恢复流程；切换期间暂停快照保存，结束后保存最终列表，重开失败按 Mod 登记。
- JSON 与 CSV 草稿必须随所属 session 保留；导航提交活动输入并等待保存，移除 session 按最新 dirty 确认放弃。
- Core 导航必须隐藏 Mod 信息入口；直接进入 Mod 信息页及恢复到该页时必须切换到 Core 概览。
- Mod 代次必须在注册时分配、移除时撤销，并且只允许保存在当前运行的内存中；恢复响应沿用捕获的代次。
- workspace 缺失返回空默认；损坏时报错且严禁立即用空态覆盖。
- 主窗口导航必须等待全部已登记保存及同步，连续请求只执行最新导航意图；输入失败保留原字段和焦点。
- 关闭工作区必须先捕获全部 session 并完成子窗口交接，再清理各 Mod 运行态；关闭范围由统一执行入口捕获并持有至所属关闭、移除或主窗口销毁动作结束，释放在同一入口完成。
- 列宽必须使用结构化 `modRoot/table/column`，严禁拼接 key。
- 启动恢复期间必须暂停自动保存，恢复结束后恢复所属持久化。
- 来源切换与启动恢复必须将最终快照处理纳入实际关闭任务；切换任务在关闭准备完成后登记。
- 来源切换的成功、取消及关闭错误必须各完成一次最终快照；写盘错误交付正在等待该任务的关闭。
- 子窗口关闭取消或保存失败必须保留所属 Mod 运行态；主窗口关闭等待全部会话的窗口生命周期交接。
- 实体定位请求必须由工作区持有并消费完整 session、Mod、种类、实体 ID 和所属行键，目标页面在读取、精确选择和滚动时消费请求；导航离开或 session 变化释放请求。
- 导航、窗口关闭、Mod 移除及工作区关闭必须先重试所属待同步结果；失败保持当前编辑面，成功后重新判定 dirty。
- 工作区恢复必须同时核对工作区代次及窗口壳接纳权；关闭撤销所属代次，迟到快照严禁建立运行态，迟到 session 由目录打开 owner 清理。
- 当前 Mod 根必须唯一归工作区，当前清单与 session 由项目清单按根派生；清单替换或移除直接更新所属投影。
- 工作区快照必须写入工具私有目录，只允许保存可恢复的目录、Mod 与列宽投影，严禁保存活动页签、全局视图或旧侧栏展开态。
- 概览成功打开 Mod 后进入该 Mod 的概览页；恢复流程严禁作为页面导航入口。
- 游戏概览、ProjectSession 与 Mod 打开失败状态必须分离并按 `modRoot` 隔离；同一 Mod 只保留最新一条失败。
- 返回目标 Mod 的当前表必须保留搜索文本、搜索项与选择；切换该 Mod 的表清空搜索文本与选择并恢复默认搜索项；列宽按所属 Mod 与表恢复。
