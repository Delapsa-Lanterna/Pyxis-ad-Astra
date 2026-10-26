# 工作区运行态与持久化

## 定义

工作区模块管理已加载 Mod、页面上下文和工作区恢复。

## 参考

### 拥有

- `src-tauri/src/commands/workspace_persistence.rs`：工作区快照加载与保存 command。
- `src-tauri/src/services/workspace_persistence.rs`：工具私有快照读写。
- `src/app/components/LoadedModsPanel.vue`：已载入 Mod 及工作区动作展示。
- `src/app/components/ModNavigation.vue`：当前 Mod 的页面与业务导航。
- `src/app/components/ModTabsBar.vue`：Mod 页签选择与移除动作展示。
- `src/app/components/OverviewPage.vue`：工作区概览、已载入 Mod 与游戏扫描组合。
- `src/app/components/workspace/WorkspaceModOverview.vue`：Mod 信息、目录、资源和数据摘要展示。
- `src/app/composables/use-workspace-navigation-actions.ts`：导航输入提交、保存等待和存活草稿交接。
- `src/app/composables/use-workspace-shell-actions.ts`：打开动作消费入口，处理 outcome 与失败反馈。
- `src/app/composables/use-workspace-shell-lifecycle.ts`：主窗口恢复、工作区持久化及保存事件生命周期。
- `src/app/composables/workspace-shell-lifecycle.spec.ts`：工作区恢复、监听及卸载行为验证。
- `src/domain/workspace/mod-navigation.spec.ts`：导航条目与顺序验证。
- `src/domain/workspace/mod-navigation.ts`：每个 Mod 的页面状态与导航投影。
- `src/domain/workspace/mod-overview.ts`：正式 manifest 的 Mod 概览统计投影。
- `src/domain/workspace/mod-status.ts`：Mod 展示状态的纯投影。
- `src/orchestrators/workspace-lifecycle.orchestrator.ts`：生命周期，拥有关闭目标捕获、所属模块清理用例与工作区关闭。
- `src/orchestrators/workspace-navigation.orchestrator.ts`：页签与页面导航，同步跨 store 运行态。
- `src/orchestrators/workspace-persistence.orchestrator.ts`：workspace 快照保存与启动恢复。
- `src/services/workspace-state.service.ts`：workspace 持久化签名与协议装配。
- `src/stores/workspace-store.spec.ts`：工作区导航与持久化状态行为验证。
- `src/stores/workspace.store.ts`：运行态，拥有当前 Mod、当前清单与 session 投影、全局页、Mod 页面上下文、概览、打开失败状态、列宽与持久化投影。

### 消费

- `src-tauri/src/models/workspace_persistence.rs`：工作区持久化 wire 契约。
- `src/app/components/file-history/WorkspaceFileHistory.vue`：文件历史页面与回放交互。
- `src/app/components/json-editor/JsonEditorWorkspace.vue`：展示当前 JSON 页面并消费所属文档运行态。
- `src/shared/types/workspace-persistence.types.ts`：工作区保存请求、目录、Mod、扫描结果及列宽快照。
- `src/shared/types/workspace.types.ts`：工作区页面与 Mod 导航契约。
- `src/stores/project.store.ts`：按 Mod 根查询正式清单与 session，当前项目投影消费原清单引用。

### 关联

- `scripts/architecture/rules/modules/workspace/workspace-module-boundary.mjs`：workspace 边界规则。

## 边界

- JSON 会话与 CSV 提供未保存判定，导航及关闭消费所属输入和保存句柄。
- JSON 文档运行态归所属模块，工作区持有当前 JSON 页面和每 Mod 导航记忆。
- Mod 概览、文件历史和 JSON 编辑使用独立工作区视图，业务侧栏消费各自导航目标。
- Mod 页面上下文、概览与打开失败状态归本次运行，列宽和目录进入恢复快照。
- workspace store 拥有全局视图、Mod 页签、运行代次、页面上下文、概览、失败记录与列宽。
- 启动恢复重建 session 与运行态，完成后显示总览。
- 导航编排按 Mod 根同步 project、tables、editor 和 history 运行态，并恢复所属页面。
- 持久化编排投影可恢复数据，Rust service 读写工具私有 workspace 文件。
- 文件浏览模块拥有按 session 隔离的目录树与浏览状态，工作区拥有 mod-files 页面及 Mod 页面记忆。
- 生命周期编排消费 Rust 实际释放结果，拥有所属 Mod 清理和前端缓存释放。
- 目录打开提供 outcome 和迟到 session 清理，工作区接纳成功建立的运行态。

## 链路

### 加载 Mod 进入运行态

1. 目录打开编排成功建立 ProjectSession。
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
3. 恢复期间自动保存暂停；完成后显示工作区总览。

### 持久化保存

1. 页签变化、列宽变化或加载列表变化触发投影保存。
2. 编排把目录、Mod 列表与列宽投影写入工具私有快照。

## 规范

- JSON 与 CSV 草稿必须随所属 session 保留；导航必须提交活动输入并等待保存，移除 session 必须按最新 dirty 确认放弃。
- JSON 页面种类必须使用 `JsonEditorPageId`；Mod 概览、文件历史和 JSON 页面必须分别通过所属导航动作激活。
- Mod 代次必须在注册时分配、移除时撤销，并且只允许保存在当前运行的内存中；恢复响应必须沿用捕获的代次。
- Mod 概览统计必须消费正式 manifest 的表格和实体摘要；页面记忆必须按 Mod 根隔离。
- mod-files 导航必须消费活动输入和保存交接，页面记忆必须归工作区，文件树状态必须由所属浏览模块管理。
- workspace 缺失返回空默认；损坏时报错且严禁立即用空态覆盖。
- 主窗口导航必须等待全部已登记保存及同步，连续请求必须只执行最新导航意图；输入失败必须保留原字段和焦点。
- 关闭工作区必须先捕获全部 session 并完成子窗口交接，再清理各 Mod 运行态；关闭范围必须由统一执行入口捕获并持有至所属关闭、移除或主窗口销毁动作结束，释放必须在同一入口完成。
- 关闭提示必须只移除当前目标失败记录或警告；再次打开、扫描或恢复检测到的问题必须按正式结果重新显示。
- 列宽必须使用结构化 `modRoot/table/column`，严禁拼接 key。
- 子窗口关闭取消或保存失败必须保留所属 Mod 运行态；主窗口关闭必须等待全部会话的窗口生命周期交接。
- 导航、窗口关闭、Mod 移除及工作区关闭必须先重试所属待同步结果；失败必须保持当前编辑面，成功后必须重新判定 dirty。
- 工作区恢复只允许拥有快照、Mod session 和运行态接纳，Core 预读取必须由窗口壳根生命周期交付。
- 工作区恢复必须同时核对工作区代次及窗口壳接纳权；关闭必须撤销所属代次，迟到快照严禁建立运行态，迟到 session 必须由目录打开 owner 清理。
- 当前 Mod 根必须唯一归工作区，当前清单与 session 必须由项目清单按根派生；清单替换或移除必须直接更新所属投影。
- 持久化只保存可恢复的目录、Mod 与列宽投影，严禁保存活动页签、全局视图或旧侧栏展开态。
- 概览刷新必须按所属会话读取 Mod 信息与 data 来源、更新正式投影及已加载卡片；工作区总览必须按游戏扫描或已加载会话执行刷新，结果接纳必须消费工作区与 session 生命周期。
- 概览成功打开 Mod 后进入该 Mod 的概览页；恢复流程严禁作为页面导航入口。
- 游戏概览、ProjectSession 与 Mod 打开失败状态必须分离并按 `modRoot` 隔离；同一 Mod 只保留最新一条失败。
- 界面刷新必须由所属根登记实际来源与动作，并沿现有保存等待、草稿和外部更新接纳流程执行。
- 表格切换必须显式接收目标 Mod；活动输入提交后的导航必须复核原身份，输入失败必须保留原输入面。
- 返回目标 Mod 的当前表必须保留搜索文本、搜索项与选择；切换该 Mod 的表必须清空搜索文本与选择并恢复默认搜索项；列宽必须按所属 Mod 与表恢复。

## 陷阱

- 关闭后接纳旧代次的扫描或恢复响应会重新建立已释放的概览和运行态。
- 关闭工作区跳过 dirty 确认会让未保存修改静默丢失。
- 恢复期间未暂停自动保存会把半恢复状态写回快照。
- 把概览扫描结果或恢复快照当作已加载运行态会让概览与 session 身份混淆。
- 用字符串拼接列宽 key 会让不同表列宽互相覆盖。
- 移除 Mod 时绕过统一清理用例会残留页签、草稿或历史状态。
