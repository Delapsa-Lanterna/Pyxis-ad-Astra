# 目录打开

## 定义

目录打开模块交付游戏与 Mod 目录的识别、扫描及结构化诊断结果。

## 参考

### 拥有

- `src-tauri/src/commands/directory_opening.rs`：目录打开 command 边界。
- `src-tauri/src/services/directory_opening/`：目录检测、游戏 Mod 发现与诊断读取。
- `src-tauri/src/services/directory_opening/detection.rs`：目录识别，判定游戏根、游戏内 Mod 与外部 Mod。
- `src-tauri/src/services/directory_opening/overview.rs`：游戏概览扫描。
- `src/app/components/ModOpeningFailureList.vue`：Mod 打开失败诊断与文件定位展示。
- `src/domain/project/load-diagnostics.ts`：加载警告与打开失败的诊断投影。
- `src/services/directory.service.ts`：目录选择、识别及概览协议。

### 消费

- `src-tauri/src/models/directory_opening.rs`：目录识别、游戏概览及打开诊断 wire 契约。
- `src-tauri/src/services/project/sources/roots.rs`：目录识别消费的游戏与 Mod 根判定和位置推断。
- `src/app/components/FeedbackFileActions.vue`：必须消费统一文件动作并展示扫描警告与打开失败的恢复按钮。
- `src/shared/lib/paths.ts`：文件系统、资源及游戏目录的路径纯规则。
- `src/shared/runtime/dialog.runtime.ts`：目录、文件、规格与图片的原生选择适配。
- `src/shared/types/directory-opening.types.ts`：目录请求、识别结果、游戏概览与结构化诊断。

### 关联

- `scripts/architecture/rules/modules/directory-opening/directory-opening-boundary.mjs`：目录打开边界规则。

## 边界

- 后端识别游戏根、游戏内 Mod 与外部 Mod，结果携带 canonical 路径和结构化诊断。
- 游戏概览读取实际 mods 目录，交付已发现条目及扫描警告。
- 目录布局与来源根推断归项目来源，目录识别消费其正式出口。
- Mod 打开失败与扫描警告的文件恢复目标由实际诊断投影交付。
- 工作区动作消费识别与扫描结果，维护所属代次、清单接纳及页面交接。

## 链路

### 目录识别

1. 目录 service 交付用户路径与已知游戏根。
2. 后端核对路径边界并读取目录布局。
3. 识别返回游戏根、游戏内 Mod、外部 Mod 或未知结果及诊断。
4. 工作区动作按捕获代次消费结果。

### 游戏概览

1. 消费者交付明确游戏根。
2. 后端通过来源根能力解析实际 mods 目录。
3. 扫描读取 Mod 摘要与结构化警告并交付结果。

## 规范

- 目录识别必须交付实际授权路径和明确种类，路径错误必须保留原始诊断。
- 游戏 mods 目录必须由同一游戏根判定及路径边界解析。
- 游戏概览必须交付实际扫描结果，Mod 会话必须由工作区动作接纳。
- 文件问题必须交付结构化位置与恢复目标，恢复展示必须消费统一反馈文件动作。
- 目录 service 必须交付所属后端能力的完整结果，工作区选择与导航必须由工作区维护。
- 目录探测及概览扫描的路径边界错误必须保留实际路径，未识别目录必须交付 Unknown 结果。
- 扫描警告与打开失败的展示必须消费结构化文件位置及统一反馈动作，关闭提示必须交付宿主事件。
