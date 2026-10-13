# 舰船编辑器

## 定义

舰船编辑器模块在独立窗口提供舰船规格的画布与字段编辑。

## 参考

`scripts/architecture/rules/editor-module-boundary.mjs`：编辑器组件边界规则 owner。
`src-tauri/src/services/project/write/entity_description.rs`：默认舰船描述键的同事务行身份更新 owner。
`src/app/components/editors/ShipEditor.vue`：舰船控件展示与事件绑定入口。
`src/app/composables/canvas/use-canvas-editor.ts`：舰船消费的共享画布交互、选区和动作提交入口。
`src/app/composables/editors/use-editor-window-view-model.ts`：消费共享窗口 ViewModel 的目标 Draft Session 与 bundle。
`src/app/composables/editors/use-resource-reference.ts`：贴图引用选择 owner。
`src/app/composables/editors/use-ship-editor-view-model.ts`：舰船草稿、模式、检查器投影与编辑动作 owner。
`src/app/renderers/editors/ship-scene.ts`：舰船场景视觉规则与绘制入口。
`src/domain/editors/lib/geometry.ts`：舰船坐标与几何转换 owner。
`src/domain/editors/lib/mirror.ts`：舰船消费的共享几何镜像规则。
`src/domain/editors/lib/normalize.ts`：`.ship` 规格归一化 owner。
`src/domain/editors/lib/ship-slots.ts`：槽位构造、甲板港口与引擎几何规则 owner。

## 边界

- ShipEditor 绑定控件、画布事件与编辑 ViewModel 动作。
- 外部快照由会话直接接纳或暂存，保存期间的新动作保持所属历史。
- 画布骨架拥有指针、选区、镜像状态和显式提交，历史消费结束后的业务动作。
- 窗口 ViewModel 拥有舰船 bundle、资源、目标草稿及保存交接。
- 编辑 ViewModel 拥有 `.ship` 本地草稿、模式、字段动作与场景输入；CSV 与描述身份由正式身份事务更新。
- 场景拥有舰船视觉规则与图层顺序，资源运行态提供可用贴图及着色结果。
- 缺失规格的导入建立待保存草稿，实际文件状态由成功写入结果确定。
- 规格窗口按实体身份登记，沉浸式窗口通过联合交接协调共同物理范围。
- 贴图浏览消费后端安全相对路径，引用字段归规格草稿。

## 链路

### 打开与画布就绪

1. 窗口按 `.ship` 目标打开并加载 bundle。
2. 组件接入编辑 ViewModel，以归一化规格建立本地草稿并注入画布 hooks。
3. 骨架挂载窗口事件、resize 与快捷键分发。
4. 贴图运行态加载当前资源，编辑 ViewModel 接纳尺寸并自适应缩放。
5. 编辑 ViewModel 装配草稿、视口、选择、资源与配色，舰船场景绘制画布。

### 画布编辑

1. 用户在总览、范围、边界、武器、甲板或引擎模式间切换。
2. 左键按模式拖动中心、护盾、半径、槽位、引擎或边界点。
3. Shift/Ctrl/Alt 组合执行新增、复制、半径或角度调整。
4. 空格开关镜像模式，配对元素成对生效。
5. 释放指针在动作边界提交一次 draft。

### 检查器编辑

1. 检查器事件进入编辑 ViewModel 的字段动作。
2. 字段动作提交 draft，并通过舰船场景重绘画布。
3. T 键展开并滚动到当前模式对应区块。

### 保存

1. 保存经窗口 ViewModel 进入编辑器写链路。
2. 实际写盘快照接纳为 base，完整 receipt 进入统一历史、会话投影与提交通知链路。
3. dirty 时外部版本暂存并提示。

## 规范

- builtInWeapons 必须以对象形状的 JSON 输入提交，原始输入必须登记到所属目标会话并参与保存、关闭与外部版本保护。
- 原规格未声明 `descriptionId` 时，`hullId` 改名必须在同一 changeset 中将旧 ID 的 `SHIP` 描述记录改为新 ID；显式 `descriptionId` 必须保持所属引用语义。
- 同 ID 保存必须使用实际已加载路径；修改 `hullId` 必须保留原目录并同步所属 CSV 的 ID 字段与文件历史。
- 画布与检查器必须通过共享骨架的显式提交入口更新所属草稿，dirty 外部内容必须暂存，保存必须提交当前指针位置并结束动作。
- 编辑器内部显示和编辑 `.ship` 的 `hullName`；编辑器外的舰船显示名称必须优先使用 `ship_data.csv` 的 `name`，仅在该名称缺失时才允许 `hullName`。
- 舰体引用、资源引用必须以后端 `ResourceRef` 或后端校验的相对路径表达。
- 舰船新建与关联创建必须消费共享模板构造；ID 与 `hullName` 必须由明确创建参数装配，builtInWeapons 必须保留全部原始槽位键。
- 贴图尺寸同步必须以实际加载贴图为准，且仅在用户显式触发时写回宽高。
- 贴图浏览只允许选择 Mod 根内 PNG，并把授权相对路径原样提交为 `spriteName`；操作只允许更新规格引用。
- 镜像新增、调整与删除必须成对生效，中轴元素必须作为单件处理；镜像联动只允许作用于正式几何集合。
- 镜像模式按空格开关，覆盖武器槽（含甲板）、引擎与碰撞边界；配对只按几何条件实时计算，严禁按下标或 ID 记忆。
- 默认描述改名必须保留描述文本、未知列、行序与注释身份；目标 `SHIP` 描述 ID 占用必须拒绝整次提交，描述文件版本必须归所属保存凭据与协调范围。

## 陷阱

- dirty 时应用外部版本会覆盖未保存画布编辑。
- 在编辑器内重建命中或选区会让画布语义偏离统一骨架。
- 直接修改 ship CSV 行会让 CSV 权威与规格文件分叉。
- 贴图浏览复制文件进 Mod 会破坏纯引用边界。
- 镜像配对按下标记忆会让删除后错配对侧元素。
