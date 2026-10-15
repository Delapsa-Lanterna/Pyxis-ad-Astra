# Spec 编辑器基础

## 定义

Spec 编辑器基础模块提供规格窗口宿主、共同输入契约和业务实现交接。

## 参考

`src/app/SpecEditorApp.vue`：规格窗口根，消费统一窗口壳。
`src/app/SpecEditorContent.vue`：业务组件挂载与窗口动作装配。
`src/app/composables/spec-editor-assembly.ts`：四类查询、定义选择及依赖装配入口。
`src/app/composables/spec-editor/spec-editor.types.ts`：目标、响应式输入及规格定义契约 owner。
`src/app/composables/spec-editor/use-spec-editor-draft-images.ts`：草稿图像读取及接纳 owner。
`src/app/composables/spec-editor/use-spec-editor-window-view-model.ts`：规格目标会话、保存与外部接纳 owner。
`src/domain/spec-editor/spec-editor-definitions.ts`：窗口名称和尺寸的纯定义。
`src/services/spec-editor.service.ts`：规格保存、导入及身份意图交接。
`src/windows/spec-editor.window.ts`：结构化规格窗口打开入口。

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
- 四类实现必须消费共同目标、保存及外部接纳协议。
- 图像与依赖读取必须消费独立输入契约，严禁通过完整窗口 VM 类型取得输入。
- 基础会话必须消费独立定义接口，具体实现选择必须归应用装配。
- 规格窗口身份必须包含 session、Mod、种类和 ID，身份接纳必须共同更新窗口与会话。
- 资源替换、基线交接及释放必须结束旧读取的接纳权。

## 陷阱

- 在定义接口文件装配业务实现会使基础会话和消费方互相引用。
- 将依赖读取结果写回业务草稿会让后台读取接管编辑动作。
- 把暂存外部版本直接交给组件会覆盖当前输入。
