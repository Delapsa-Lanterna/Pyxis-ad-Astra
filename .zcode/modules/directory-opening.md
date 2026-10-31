# 目录打开

## 定义

目录打开模块识别游戏与 Mod 目录，并交接项目打开结果。

## 参考

### 拥有

- `src-tauri/src/commands/directory_opening.rs`：目录打开 command 边界。
- `src-tauri/src/services/directory_opening/`：目录检测、游戏 Mod 发现与诊断读取。
- `src-tauri/src/services/directory_opening/detection.rs`：目录识别，判定游戏根、游戏内 Mod 与外部 Mod。
- `src-tauri/src/services/directory_opening/overview.rs`：游戏概览扫描。
- `src/app/components/GameOverviewPanel.vue`：游戏目录扫描结果、警告及打开动作展示。
- `src/app/components/ModOpeningFailureList.vue`：Mod 打开失败诊断与文件定位展示。
- `src/domain/project/load-diagnostics.ts`：加载警告与打开失败的诊断投影。
- `src/orchestrators/directory-opening.orchestrator.ts`：打开编排，拥有识别分流、打开结果形状与失败回滚。
- `src/services/directory.service.ts`：目录选择、识别及概览协议。

### 消费

- `src-tauri/src/models/directory_opening.rs`：目录识别、游戏概览及打开诊断 wire 契约。
- `src-tauri/src/services/project/sources/roots.rs`：目录识别消费的游戏与 Mod 根判定和位置推断。
- `src-tauri/src/services/project_session.rs`：打开动作的 ProjectSession 建立交接能力。
- `src/app/components/FeedbackFileActions.vue`：必须消费统一文件动作并展示扫描警告与打开失败的恢复按钮。
- `src/app/composables/use-workspace-shell-actions.ts`：打开动作消费入口，处理 outcome 与失败反馈。
- `src/shared/lib/paths.ts`：文件系统、资源及游戏目录的路径纯规则。
- `src/shared/runtime/dialog.runtime.ts`：目录、文件、规格与图片的原生选择适配。
- `src/shared/types/directory-opening.types.ts`：目录请求、识别结果、游戏概览与结构化诊断。

### 关联

- `scripts/architecture/rules/modules/directory-opening/directory-opening-boundary.mjs`：目录打开边界规则。

## 边界

- dirty 确认与运行态释放归工作区生命周期，失败记录按 Mod 根保留。
- 后端识别游戏根与 Mod 目录并授权 canonical 路径，前端消费识别结果和打开 outcome。
- 根布局与推断必须通过项目来源正式出口消费，概览和识别结果必须由目录打开维护。
- 打开编排拥有分流、打开代次、session 建立交接与失败清理。
- 扫描警告与恢复目标由后端提供结构化诊断，反馈层投影用户文案和授权动作。
- 游戏概览和 ProjectSession 分别表达，业务 query 消费成功建立的 session。
- 重复打开已加载 Mod 通过工作区导航接纳，沿用所属运行态。

## 链路

### 打开目录

1. 用户经目录选择对话框提交路径。
2. 编排层调用后端目录识别。
3. 识别为游戏根时写入游戏概览并返回概览 outcome。
4. 识别为游戏内 Mod 时先写入概览，再进入 Mod 打开链路。
5. 识别为外部 Mod 时直接进入 Mod 打开链路。
6. 无法识别时返回带消息的未知 outcome。

### 打开 Mod 项目

1. 编排层检查该 `modRoot` 是否已在工作区。
2. 已存在时按请求视图做幂等导航并返回已加载 outcome。
3. 新 Mod 注册 loading 条目与打开代次并激活概览。
4. 调用后端打开 ProjectSession；仍持有当前代次时注册 manifest，失去代次时关闭返回的 session 并返回取消 outcome。
5. 成功后更新条目名称与状态，并按性能打点水合运行态。
6. 失败时回滚五个 store 运行态、写入打开失败记录并向调用点抛出。

### 从概览打开 Mod

1. 用户在游戏概览中打开某个 Mod。
2. 编排层以概览的 `starsectorRoot` 作为已知游戏根。
3. 复用 Mod 打开链路并返回 outcome。

### 新建 Mod 后打开

1. 新建完成后按是否提供游戏根决定打开后的视图。
2. 提供游戏根时先扫描游戏概览再打开。
3. 复用 Mod 打开链路返回 outcome，不重新识别刚创建的目录。

## 规范

- Mod 打开失败与游戏扫描警告必须逐条提供关闭提示按钮，关闭事件必须交付工作区拥有的状态动作。
- Mod 打开失败必须在清理运行态前捕获恢复目标，列表与后续弹出提示必须消费同一目标及窗口反馈动作。
- 游戏扫描发现的文件问题必须交付结构化文件位置与编辑目标，概览按钮必须消费统一文件动作。
- loading 条目必须先于后端调用注册，避免窗口期重复触发。
- manifest 登记、运行态水合与失败回滚必须属于发起打开时的 Mod 代次；移除后到达的成功响应必须关闭对应 session。
- 回滚后必须回到工作区总览，严禁停留在半初始化页面。
- 已加载 Mod 的重复打开必须作为幂等导航接纳，严禁重建 session 或清空所属草稿与历史。
- 成功打开对应 Mod、成功刷新或关闭工作区必须清理适用的打开失败记录。
- 打开 outcome 必须区分游戏概览、新加载、已加载、取消与未知五种形状；取消结果只允许结束对应打开动作。
- 打开失败回滚必须移除所属 loading 条目并保留其它 Mod 的失败记录。
- 打开成功必须同步活动视图：概览请求显示工作区总览，Mod 请求进入该 Mod 概览。
- 概览扫描结果只允许作为概览数据，工作区运行态必须消费成功建立的 session。
- 游戏目录的 `mods` 目标必须由后端以同一游戏根判定和路径边界解析。
- 目录探测、创建后概览扫描与工作区刷新必须捕获工作区代次；关闭工作区后到达的扫描结果只允许结束原动作，严禁重新写入概览。
- 目录探测的路径边界失败作为错误返回；未识别目录只以 Unknown outcome 表达，严禁折叠成 warning；概览扫描的根目录校验失败同样作为错误返回。
