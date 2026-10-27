# 主窗口历史命令与快捷键分发

## 定义

主窗口历史命令与快捷键分发模块统一键位语义及保存、撤销和重做的分派。

## 参考

### 拥有

- `src/app/composables/use-main-window-shortcuts.ts`：主窗口快捷键装配，连接保存注册表与历史编排。
- `src/app/composables/use-shortcut-dispatch.ts`：快捷键分发唯一，拥有 window 监听、命令路由、纯键表分发与命中拦截。
- `src/domain/workspace/main-window-commands.ts`：快捷键命令映射唯一，拥有 undo/redo/save/close 键位表与输入焦点豁免策略。
- `src/orchestrators/main-history-command.orchestrator.spec.ts`：JSON、CSV 与文件历史的分派优先级验证。
- `src/orchestrators/main-history-command.orchestrator.ts`：历史分派，当前 JSON 草稿与 CSV 草稿优先于文件 history。

### 消费

- `src/app/composables/canvas/use-canvas-editor.ts`：画布骨架快捷键消费方，经分发器路由 undo/redo 与画布纯键。
- `src/orchestrators/file-history-replay.orchestrator.ts`：文件历史回放。
- `src/stores/csv-editor.store.ts`：当前表格的输入、操作历史及身份交接锁。
- `src/stores/json-editor.store.ts`：当前 JSON 文档会话的撤销、重做与输入交接。
- `src/stores/project.store.ts`：指定 Mod 的正式清单与 session 查询，异步动作消费捕获目标。
- `src/stores/save-command.store.ts`：活动保存命令、目标保存句柄和交接意图序号。
- `src/stores/workspace.store.ts`：当前 Mod 选择、清单与 session 的派生投影。

### 装配

- `src/app/AppContent.vue`：主窗口装配入口，注册活动保存目标与窗口快捷键。

## 边界

- Ctrl+S 提供全局保存语义，文本编辑面按声明启用快照撤销，其他输入保留原生编辑。
- domain 拥有统一快捷键映射与输入焦点策略，分发器拥有 window 监听和命令路由。
- save-command store 登记活动命令、保存句柄、等待能力与交接意图。
- 主窗口装配连接活动保存命令与历史编排，子窗口消费同一键位表。
- 分发器拦截已注册且命中的命令，未注册处理器的键由当前输入面继续处理。
- 导航和生命周期动作消费所属保存句柄，连续意图按所属请求接纳。
- 当前可见编辑面的草稿历史先处理撤销重做，所属栈为空时进入当前 Mod 文件历史。

## 链路

### 撤销与重做分派

1. 用户按下撤销或重做组合键。
2. domain 映射产生 undo 或 redo 命令并检查输入焦点豁免。
3. 分发器阻止默认行为并调用历史编排。
4. 历史编排按当前页面选择 JSON 文档或当前 CSV 表格，提交所属输入后复核 Mod、session、页面和目标。
5. 所属草稿栈存在条目时执行对应撤销或重做。
6. 所属草稿栈为空或当前页面为其他视图时调用当前 Mod 的文件历史回放。
7. 输入拒绝、身份变化或编辑交接锁占用时结束当前命令。

### 保存分派

1. 用户按下 Ctrl+S。
2. domain 映射产生 save 命令，输入焦点不构成豁免。
3. 分发器调用保存命令 store 的分派。
4. 活动文档动作进入 CSV 与 JSON 共同队列，类型规则执行所属保存编排并返回统一结果。
5. 无活动目标时命令静默结束。

### 编辑器窗口快捷键

1. 画布编辑器以编辑器 hooks 装配分发器。
2. 组合键进入 undo/redo 命令并触发编辑器内撤销栈。
3. 纯键（空格、退格、模式键、视图键）经键表分发到画布动作。
4. 输入框、文本域、下拉与可编辑元素内的纯键不触发分发。

## 规范

- CSV 与 JSON 历史动作必须分别返回已处理、输入拒绝或草稿耗尽；只有草稿耗尽才允许进入 File History。
- CSV 草稿历史只允许在表格页面消费；输入提交后必须复核所属 Mod、session、页面、当前表及交接锁。
- Ctrl+S 只允许分派给当前窗口唯一登记的活动保存动作。
- JSON 文档只允许在所属 JSON 页面激活期间成为主窗口历史目标；撤销与重做必须提交当前字段输入后复核目标身份。
- undo/redo 的可编辑目标豁免必须可按表面开启，文本编辑面必须开启。
- 主窗口历史分派失败只呈现反馈，严禁改变历史栈状态。
- 主窗口装配必须消费统一分发器，键盘解析只允许由领域键位表完成，历史调用必须经过正式分派。
- 当前展示目标必须消费工作区的当前项目投影，异步动作必须捕获并持续消费所属 Mod 根与 session。
- 快捷键纯键命中必须阻止默认行为；命令命中但无处理器时严禁阻止默认行为。
- 快捷键触发必须避免与输入控件、schema 控件、CSV 单元格编辑器和系统快捷键冲突。
- 检查器与 schema 的输入焦点必须保留原生撤销体验；文本文件编辑面必须按已声明的焦点策略消费文本快照历史。
- 草稿分派必须只消费当前可见编辑面；JSON 对应栈为空时只允许交接文件历史。
- 菜单优先按键必须先于业务快捷键执行，已处理事件必须由其余分发器保留处理结果。
- 输入焦点豁免只适用于 undo/redo 与纯键，严禁豁免 save 与 close。
- 键位表必须以主窗口既有键位为全窗口基准：Ctrl+S 保存、Ctrl+Z 撤销、Ctrl+Shift+Z 与 Ctrl+Y 重做、Escape 关闭。
