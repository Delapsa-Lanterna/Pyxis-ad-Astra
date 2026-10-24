# Spec 编辑器基础

## 定义

Spec 编辑器基础模块提供规格窗口宿主、共同输入契约和业务实现交接。

## 参考

### 拥有

- `schemas/spec-defaults.json`：舰船、武器、弹体、系统与技能规格的默认模板资产。
- `src-tauri/src/commands/spec_editor.rs`：规格保存及外部规格导入 command。
- `src-tauri/src/services/spec_editor.rs`：正式外部规格导入及保存链路的测试适配。
- `src/app/components/spec-editor/SpecFieldList.vue`：同构字段、默认值展示和辅助动作事件。
- `src/app/composables/spec-editor/spec-editor.types.ts`：目标、响应式输入及规格定义契约。
- `src/app/composables/spec-editor/spec-schema-context.ts`：所属规格目标的字段来源上下文交付。
- `src/app/composables/spec-editor/use-spec-editor-draft-images.ts`：草稿图像读取及接纳。
- `src/app/composables/spec-editor/use-spec-editor-window-view-model.ts`：四类规格目标会话、保存、身份与外部基线接纳。
- `src/domain/editors/lib/game-spec-enums.ts`：弹体、导弹与战术系统分支的游戏枚举。
- `src/domain/editors/spec-construction.ts`：规格模板、字段定义和所属路径更新。
- `src/domain/spec-editor/spec-editor-definitions.ts`：窗口名称和尺寸的纯定义。
- `src/domain/spec-editor/spec-normalization.spec.ts`：四类规格的集合默认值与归一化验证。
- `src/orchestrators/editor-window.orchestrator.ts`：规格保存结果发布与所属提交事件过滤。
- `src/services/spec-editor.service.ts`：规格保存、导入及身份意图交接。
- `src/windows/spec-editor.window.ts`：四类规格的身份、尺寸与结构化窗口请求。

### 消费

- `src-tauri/src/models/spec_editor.rs`：规格种类、武器分支、保存及外部导入请求协议。
- `src/app/components/editors/common/EditorFooter.vue`：编辑与预览共用的说明及操作插槽。
- `src/app/components/editors/common/EditorHeader.vue`：编辑与预览共用的标题、dirty、外部基线及动作插槽。
- `src/app/components/editors/common/EditorInspector.vue`：编辑与预览共用的属性区标题及独立滚动容器。
- `src/app/components/schema/SchemaValueInput.vue`：声明来源的规格引用字段控件。
- `src/app/composables/use-field-input-actions.ts`：所属输入集合登记、活动输入提交与释放。
- `src/app/composables/use-schema-runtime-context.ts`：按 session 与 Mod 根建立字段来源查询和失效订阅。
- `src/domain/edit-session.ts`：编辑会话与撤销栈原语，拥有 base/draft/dirty/revision/pending external 状态机与双栈状态工厂。
- `src/domain/project/entity-definitions.ts`：实体内容 ID 字段及字符串 ID 提取。
- `src/domain/project/entity-versions.ts`：保存目标版本捕获与关联表凭据交接。
- `src/orchestrators/json-write-confirmation.orchestrator.ts`：JSON 原文保留、重排确认与写入重试交接。
- `src/shared/runtime/dialog.runtime.ts`：目录、文件、规格与图片的原生选择适配。
- `src/shared/types/spec-editor.types.ts`：规格种类、分支、保存及导入请求与窗口业务读取投影。
- `src/shared/ui/FieldLabel.vue`：显式名称、字段键与完整路径的共同标签。
- `src/shared/ui/FieldRow.vue`：字段、集合、说明与辅助动作的共同展示。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。
- `src/app/SpecEditorApp.vue`：规格窗口根，消费统一窗口壳。
- `src/app/SpecEditorContent.vue`：四类规格组件、窗口会话、依赖与跨窗口动作装配。
- `src/app/composables/spec-editor-assembly.ts`：四类查询、定义选择及依赖装配入口。

## 边界

- 业务实现拥有字段、领域动作、场景与所属展示状态。
- 图像读取消费目标、草稿及编辑上下文，拥有读取票据和结果。
- 基础契约表达规格目标、响应式输入和读取定义。
- 应用装配选择四类业务定义、组件及依赖读取。
- 窗口会话拥有目标、版本、dirty、保存及外部基线。
- 编辑文档拥有工作值、动作起点和历史边界。

## 链路

### 打开与依赖

1. 窗口请求交付所属 session、Mod、种类与 ID。
2. 应用装配选择业务读取定义并建立规格会话。
3. 会话接纳正式目标、版本和规格，业务依赖消费当前草稿与上下文。
4. 对应组件和 ViewModel 接纳规格并建立所属交互。

### 编辑与交接

1. 字段和画布动作经编辑文档发布所属草稿。
2. 保存提交活动输入并消费正式身份准备与事务。
3. 实际写盘内容交接基线，后续编辑保留所属历史。
4. 外部内容经会话接纳或暂存，窗口释放所属输入与读取。

## 规范

- 保存必须先提交所属活动输入，后续草稿必须按实际基线交接。
- 可选字段的展示默认值必须保持读取性质；恢复默认必须删除所属键，嵌套更新必须保留其它业务字段。
- 四类实现必须消费共同目标、保存及外部接纳协议。
- 图像与依赖读取必须消费独立输入契约，严禁通过完整窗口 VM 类型取得输入。
- 基础会话必须消费独立定义接口，具体实现选择必须归应用装配。
- 字段声明来源时必须消费字段模式的查询与控件，所属目标必须由规格宿主交付，刷新必须覆盖引用目录的 Mod 与 Core 路径。
- 字段必须以完整字段行消费共同标签与值控件，中文名称、原始键和完整路径必须显式交付。
- 折叠分组必须消费 EditorCollapse 与 Naive 折叠项，首次展开后必须保留原文、校验和输入登记。
- 规格窗口身份必须包含 session、Mod、种类和 ID，身份接纳必须共同更新窗口与会话。
- 资源替换、基线交接及释放必须结束旧读取的接纳权。

## 陷阱

- 在定义接口文件装配业务实现会使基础会话和消费方互相引用。
- 将依赖读取结果写回业务草稿会让后台读取接管编辑动作。
- 把暂存外部版本直接交给组件会覆盖当前输入。
