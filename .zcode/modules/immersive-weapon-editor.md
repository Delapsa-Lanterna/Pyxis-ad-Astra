# 沉浸式武器编辑器

## 定义

沉浸式武器编辑器模块提供武器信息、统计、分支动作及弹体与开火预览打开交接。

## 参考

### 拥有

- `src/app/components/immersive/ImmersiveHighlightedText.vue`：武器说明高亮文本展示。
- `src/app/components/immersive/weapon/`：武器信息与弹体及开火预览事件展示。
- `src/app/components/immersive/weapon/WeaponImmersivePanel.vue`：武器内容与弹体及开火预览事件入口。
- `src/app/composables/immersive-editor/weapon/`：武器分支、弹体及开火预览动作。
- `src/app/composables/immersive-editor/weapon/use-immersive-weapon-editor.ts`：分支覆盖、弹体及开火预览动作。
- `src/domain/immersive/weapon/`：武器字段、统计与信息投影。
- `src/domain/immersive/weapon/weapon-panel.ts`：武器字段、说明、图标来源和分支投影。
- `src/domain/immersive/weapon/weapon-statistics.ts`：武器周期、弹药与伤害统计纯规则。

### 消费

- `src/test/fixtures/joint-edit/weapon-joint-edit.ts`：武器联合来源与规格的测试构造。
- `src/windows/weapon-fire-preview.window.ts`：独立武器草稿的开火预览窗口交接。

## 边界

- 共同运行态拥有联合草稿、历史与保存。
- 内容组件通过显式事件请求打开所属弹体与开火预览。
- 分支动作消费当前会话输入与独立业务值。
- 只读候选消费武器内容与静态图标投影。
- 武器实现拥有说明、派生统计及覆盖选择。

## 链路

### 武器内容与分支

1. 武器定义投影规格、CSV、描述和弹体关联。
2. 字段转换按武器分支规则补齐必读内容。
3. 覆盖动作确认当前来源及合法分支后交付联合会话。
4. 内容组件共同呈现编辑窗口与只读候选。

### 打开弹体与开火预览

1. 弹体与开火预览入口交付武器专属动作。
2. 动作提交活动输入并核对捕获的会话。
3. 弹体动作读取当前引用并交付 Spec 弹体窗口，开火预览动作克隆当前武器规格并交付 draft 来源。

## 规范

- 分支转换必须经所属字段规则交付独立草稿，未知业务字段必须保留。
- 弹体与开火预览动作必须归武器实现，基础展示协议严禁承载该动作。
- 弹体与开火预览打开必须提交活动输入并核对目标与接纳权；开火预览必须交付独立武器规格快照。
- 武器描述必须以武器 ID 与 `WEAPON` 类型定位，用途必须优先消费 `primaryRoleStr`，再消费描述 `text2`；派生值和覆盖文本必须共同绑定实际来源参数。
- 武器来源必须以 CSV 提供名称、性能及伤害类型，以规格提供类型、尺寸、挂载和发射参数；弹体只允许作为只读关联和独立编辑目标。
- 武器统计必须消费原版发射点、模式、充能、连射、光束周期与弹药恢复规则；高亮只允许作为逐字片段展示，严禁解释为 HTML。

## 陷阱

- 从原始输入直接打开引用会交付尚未提交的目标。
- 在只读候选中接入编辑动作会混淆展示权限。
- 将弹体完整规格纳入武器可编辑集合会扩大保存范围。
