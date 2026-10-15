# Spec 战术系统编辑器

## 定义

战术系统编辑器模块提供系统规格的字段编辑与保存交接。

## 参考

`scripts/architecture/rules/editor-module-boundary.mjs`：编辑器组件边界规则 owner。
`src/app/components/spec-editor/system/SpecSystemEditor.vue`：系统表单展示与事件绑定入口。
`src/app/composables/editors/use-editor-fields.ts`：系统消费的文档字段、颜色与对象绑定入口。
`src/app/composables/spec-editor/system/use-spec-system-editor-view-model.ts`：系统草稿、条件投影、字段转换与显式动作 owner。
`src/app/composables/spec-editor/use-spec-editor-window-view-model.ts`：共享窗口 ViewModel 交接，消费战术系统目标 Draft Session。
`src/domain/schema/schema.types.ts`：系统表单消费的正式 schema 类型。
`src/domain/spec-editor/system/spec-system-fields.ts`：系统结构化字段与规格归一化 owner。
`src/services/spec-system-editor.service.ts`：战术系统规格与实际目标的查询入口。
`src/shared/ui/JsonFieldEditor.vue`：额外字段结构化编辑 owner。

## 边界

- SpecSystemEditor 绑定表单控件与编辑 ViewModel 动作，编辑文档拥有工作值与动作提交，ViewModel 提供条件展示与字段绑定。
- type 控制行为区段展示，共享视觉属性与已有字段保留在同一草稿。
- 写入归编辑器事务，receipt 经统一文件历史、项目投影和窗口通知接纳。
- 窗口 ViewModel 拥有 bundle、目标会话、外部版本及保存交接。
- 规格归一化归领域入口，字段形状由正式 schema 和 JSON 输入共同表达。
- 额外字段编辑归共享结构化组件，编辑 ViewModel 组合已声明字段与额外业务键。

## 链路

### 打开与表单渲染

1. 窗口按 `.system` 目标打开并加载 bundle。
2. 组件接入编辑 ViewModel，编辑文档接纳归一化工作值。
3. 编辑 ViewModel 按 type 投影行为、音效、视觉与伤害区段，组件渲染对应控件。

### 字段编辑

1. 字段输入进入编辑 ViewModel 动作，写入草稿并显式提交。
2. 颜色与枚举经计算属性 setter 提交。
3. type 切换先提交活动输入，再更新类型值并提交完整草稿。
4. 无人机行为 JSON 在提交边界解析并提交。

### 额外字段

1. 编辑 ViewModel 收集非结构化键组成额外字段模型。
2. 结构化编辑器增删或修改额外字段。
3. 编辑 ViewModel 合并结构化字段与额外业务字段后提交完整草稿。

### 保存

1. 保存经窗口 ViewModel 进入编辑器写链路。
2. 会话接纳实际写盘内容与版本，再执行文件历史和 session refresh。
3. dirty 时外部更新暂存并提示。

## 规范

- Smart 数值原文必须登记到所属会话；保存期间的新编辑必须按实际写盘基线保留，外部基线与重置必须共同交接本地规格和输入。
- 保存必须先提交所属活动输入；非法输入必须保留原文与正式类型并定位，外部版本载入必须确认放弃后接纳。
- 全部业务键必须原样保留；保存必须消费实际 `.system` 目标，ID 修改必须由所属事务更新唯一关联 CSV 行。
- 未知字段必须完整保留并进入额外字段编辑，严禁静默丢弃。
- 独立窗口的 query 与保存必须携带完整窗口身份。
- 界面刷新必须由所属根登记实际来源与动作，并沿现有保存等待、草稿和外部更新接纳流程执行。
- 系统字段和条件区段必须经显式提交入口更新完整草稿，type 切换必须保留全部已有字段，严禁以展示条件删除配置。
- 系统新建与缺失规格草稿必须消费共享模板构造，type 必须为 `STAT_MOD`、aiType 必须为 `NONE`。
- 系统类型必须覆盖游戏正式 11 项枚举；共享引擎、护盾和透明度属性必须在全部类型可编辑。
- 颜色字段必须保持四通道数组形状；数值字段保留其步长语义。

## 陷阱

- 在组件内直连 IPC 会绕过窗口 ViewModel 与保存链路。
- 把展示条件作为写盘删除依据会丢失其他行为区段的已有配置。
- 按行为类型删去共享视觉属性会改变系统基类的有效配置。
- 用整段 JSON 文本编辑额外字段会让合法字段被误删。
- 静默吞掉 JSON 解析失败会让用户误以为已保存。
