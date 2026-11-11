# 文本文件编辑

## 定义

文本文件编辑模块维护打开文本文件的编辑状态、文件标签、关联修改及保存释放。

## 参考

### 拥有

- `src-tauri/src/commands/text_file_editing.rs`：文本读取的命令边界。
- `src-tauri/src/domain/text_file.rs`：文本内容分类。
- `src-tauri/src/services/text_file_editing.rs`：同次字节判定、文本加载、保存准备、原文写入及批次变更集。
- `src/app/components/text-file-editing/`：文件标签展示、激活、关闭与排序交互。
- `src/app/composables/text-file-editing/`：文件编辑状态、打开集合、关联历史及保存关闭。
- `src/domain/text-file-editing/`：同名文件标签的路径区分。
- `src/services/text-file-editing.service.ts`：文本读取、单文件及批次保存的类型化传输。

### 消费

- `src-tauri/src/errors.rs`：文件错误与实际位置。
- `src-tauri/src/io/mod.rs`：授权路径、同次字节与版本、文件变更集及写入租约。
- `src-tauri/src/models/text_file_editing.rs`：文本内容、来源版本、保存请求和文件打开结果。
- `src-tauri/src/parsers/game/text.rs`：严格文本解码。
- `src-tauri/src/services/project/mod.rs`：正式会话范围授权。
- `src-tauri/src/services/project/query/entity_targets.rs`：已识别文本的实体目标与关联版本。
- `src-tauri/src/services/project/session.rs`：当前会话所属根的正式授权。
- `src/app/composables/use-app-feedback.ts`：文件错误及完整影响确认。
- `src/app/composables/use-edit-target-draft-session.ts`：草稿、磁盘基线、保存接纳与读取寿命。
- `src/app/composables/use-field-input-actions.ts`：当前目标的外部文本载入确认。
- `src/domain/project-sync/committed-text.ts`：正式回执中的完整文件文本。
- `src/orchestrators/project-sync.orchestrator.ts`：保存请求、回执接纳、外部变化及项目交付等待。
- `src/orchestrators/window-identity.orchestrator.ts`：关联保存的来源和目标预约。
- `src/shared/runtime/text-document.ts`：不可变文本、原始换行、输入、历史及视图状态。
- `src/shared/types/text-file-editing.types.ts`：文件打开、读取与保存结果协议。
- `src/stores/save-command.store.ts`：文件保存参与者及关闭校验。
- `src/stores/settings.store.ts`：文本历史容量。

### 装配

- `src-tauri/src/services/project_save.rs`：经项目队列交付原文与批次保存。
- `src/app/components/code-editor/CodeEditorContent.vue`：在项目窗口装配文件标签和活动正文。
- `src/app/composables/code-editor/use-code-editor-window.ts`：文件集合、原生请求及 Java 修改交接。
- `src/app/composables/editors/use-text-editor-view-model.ts`：独立文本窗口消费共同文件状态。

## 边界

- 每份文件状态持有路径、磁盘基线、草稿、历史、外部版本、选区、滚动及在途保存。
- 打开集合持有活动文件、标签顺序和文件打开队列，文件状态随标签释放。
- 关联修改维护每次操作的前后文本与路径，待保存关联和撤销历史分别维护。
- 保存消费正式目标预约、项目队列、文件提交及回执交付。
- 原文修改方案由调用方生成并验证，模块负责核对当前文本和接纳关联修改。
- 只读快照持有来源文字及阅读状态，输入和保存能力按只读身份交付。

## 链路

### 打开与编辑

1. 调用方交付所属项目和文件请求，打开集合顺序加载文件并交付逐文件结果。
2. 同次字节判定文本并解码，文件状态接纳文字、实体目标和来源版本。
3. 同路径打开复用已有文件，标签切换恢复所属内存文本和视图状态。
4. 外部内容按实际文件投递，草稿与外部版本按正式接纳条件维护。

### 关联修改与保存

1. 来源验证及全部文件文本复核成功后，共同接纳范围修改和待保存路径。
2. 保存按相交未保存操作计算关联文件，提交输入并捕获不可变文本和版本。
3. 正式项目队列执行同根变更集，回执接纳磁盘基线并保留后续输入。
4. 保存完成结束所属待保存关联，撤销历史按操作继续保留。
5. 撤销或重做共同恢复操作涉及的文本和路径，并重新登记待保存关联。

### 关闭

1. 标签关闭等待保存并捕获全部关联文件的当前内容。
2. 确认列出关联文件及路径变化，保存或放弃覆盖已确认的全部未保存文字。
3. 确认内容仍有效后释放文件，结束涉及该文件的关联历史并保留其它有效历史。
4. 集合释放结束全部读取、监听、文件状态和保存登记。

## 规范

- 同路径重复打开及已载入标签切换必须复用当前文件状态。
- 打开及激活文件必须交付可见的所属标签，只读身份与文件名分别呈现。
- 文件标签状态灯依次表达未保存、文件错误、保存中及已保存，只读快照保留明确身份。
- 全文生成归保存或明确内容交接，关闭校验消费不可变内容快照。
- 关联修改必须在验证完成后共同复核文件目标、路径、来源版本及文本，再修改草稿。
- 独立操作分别保存，相交未保存操作维护唯一文件集合并共同保存。
- 保存捕获必须等待输入提交，回执必须交给原文件并保留后续输入。
- 放弃确认必须列全关联文件及待保存改名，确认后再次核对内容与身份。
- 关闭成员必须结束涉及该成员的关联撤销能力，并在剩余文件到达该历史边界时交付反馈。
- 文本和文件历史容量分别消费正式设置及所属实现。
