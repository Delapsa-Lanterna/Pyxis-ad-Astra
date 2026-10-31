# 保存提交

## 定义

保存提交模块提供按项目顺序执行的文件事务、文件历史和未完成投影恢复。

## 参考

### 拥有

- `src-tauri/src/domain/save_edits.rs`：当前正式内容的字段修改应用。
- `src-tauri/src/services/write_transactions.rs`：根租约、实际写入结果、历史登记、回放及正式投影提交。
- `src-tauri/src/services/write_transactions/committed.rs`：未完成投影及恢复期间的内容持有。
- `src/domain/project/save-edits.ts`：本次保存的实际字段赋值、移除及数组整体修改提取。
- `src/orchestrators/json-write-confirmation.orchestrator.ts`：JSON 原文保留、逐源重排确认及版本绑定的写入重试。

### 消费

- `src-tauri/src/io/file_changes.rs`：根写入租约和文件变更集应用。
- `src-tauri/src/models/document_identity.rs`：JSON 内容所属文档与配置类别。
- `src-tauri/src/models/joint_target.rs`：联合保存的业务根与目标类别。
- `src-tauri/src/models/json_write.rs`：JSON 原文保留及逐源确认选项。
- `src-tauri/src/models/project_identity.rs`：保存消费的会话、实体和版本身份。
- `src-tauri/src/models/save_action.rs`：保存请求与明确业务动作聚合。
- `src-tauri/src/models/write_commit.rs`：字段修改、实际结果及内容交付。
- `src-tauri/src/services/file_history.rs`：文件撤销重做。
- `src-tauri/src/services/project/mod.rs`：会话授权和正式结果。
- `src/shared/types/document-identity.types.ts`：JSON 文档来源与内容身份。
- `src/shared/types/joint-target.types.ts`：联合保存的根身份。
- `src/shared/types/json-write.types.ts`：JSON 原文保留与逐源确认输入。
- `src/shared/types/save-action.types.ts`：保存请求与业务动作输入。
- `src/shared/types/write-commit.types.ts`：前端实际保存结果和窗口交接类型。

### 装配

- `src-tauri/command-macros/`：正式保存命令接入。
- `src-tauri/src/commands/project_save.rs`：统一保存命令的完整请求入口。
- `src-tauri/src/services/project_save.rs`：完整保存请求的业务准备、事务执行及实际结果交付。
- `src/orchestrators/project-sync.orchestrator.ts`：保存结果的窗口消费。

## 边界

- 业务写入必须在所属事务内生成各文件的实际最终内容。
- 保存输入必须归发起编辑会话，捕获后的草稿操作必须保持独立。
- 事务修改提取必须归保存提交，正式结果与后续草稿合并必须消费编辑会话领域规则。
- 多文件修改必须共同交给一次历史登记和一个保存事件。
- 投影恢复必须持有实际写入范围及未完成状态。
- 文件历史必须独立持有配置范围内的撤销重做内容。
- 项目队列必须覆盖文件准备、来源确认、写入、失败恢复、历史和正式内容登记。

## 链路

### 保存

1. 保存入口捕获实际业务修改、完整目标和读取凭据。
2. 所属项目队列取得执行位置，准备当前正式内容。
3. 事务核对权限和磁盘凭据，业务写入完成文件变更集。
4. 文件历史登记实际写入，会话构建正式结果。
5. 项目同步必须顺序发布完整保存结果，保存调用必须返回项目执行结果。
6. 项目必须在发布结果后释放所属工作并执行后续请求。

### 恢复

1. 写入失败必须按相反顺序恢复本次已执行和部分执行的文件操作。
2. 恢复受阻必须保留尚未完成步骤及所属项目队列位置。
3. 全部文件已完成后的历史与正式内容登记失败必须继续所属登记。
4. 恢复完成必须结束失败请求，后续请求必须按恢复后的内容继续。

## 规范

- JSON 写入必须消费实际设置和来源格式确认。
- 保存请求必须归动作聚合，业务输入与提交结果必须共同消费公共目标身份，JSON 写入选项必须保持公共协议归属。
- 项目文件保存与回放必须经过所属项目队列、根事务租约、路径授权及版本复核，并交付统一 `WriteResult`；组件、store 与 query 严禁直接写项目文件。
- 同次修改的各文件必须在最终内容汇合后写入。
- 实际结果必须共同交付文件变化、行键、身份、历史及受影响会话。
- 文件写入失败必须恢复本次修改，文本恢复必须保留原始字节、路径和存在状态。
- 已写盘后的登记失败必须继续所属登记，历史必须登记一次。
- 保存请求必须归所属项目维护，接收窗口释放必须继续已接收请求。
- 来源重建必须明确确认缺失路径并消费本次捕获内容，确认后必须重新核对文件。
- 来源确认必须绑定所属请求、实际缺失路径及当前接收身份，接收方释放后必须向当前项目的可用接收方交接。
- 恢复资料必须按当前进程内工作寿命维护，完成或明确放弃后必须释放。
- 成功恢复记录必须立即释放。
- 提交内容必须共同表达所属目标和实际返回形状。
- 草稿及草稿历史必须归所属会话，保存完成必须保留捕获后的独立修改。
