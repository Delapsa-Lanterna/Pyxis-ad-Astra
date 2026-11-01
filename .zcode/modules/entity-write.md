# 实体文件写入与身份联动

## 定义

实体文件写入与身份联动模块构造实体内容并完成实体文件及关联身份的实际修改。

## 参考

### 拥有

- `schemas/spec-defaults.json`：实体规格及嵌套对象的初始内容模板。
- `src-tauri/src/domain/entity_construction.rs`：规格构造与武器内容校验。
- `src-tauri/src/services/project/write/entity_write.rs`：业务模块登记和正式能力接口。
- `src-tauri/src/services/project/write/entity_write/`：实体内容、关联规格、描述、父引用、单文件和势力索引写入。
- `src/domain/entity-write/`：前端规格、装配和皮肤构造及分支补全。
- `src/orchestrators/entity-write.orchestrator.ts`：实体 ID 修改后的文件名选择。

### 消费

- `src-tauri/src/domain/variant_modules.rs`：装配模块的共同格式规则。
- `src-tauri/src/io/`：授权路径、JSON 原文渲染与同根变更集。
- `src-tauri/src/services/project/session/csv_tables.rs`：正式表格、行身份与来源版本。
- `src-tauri/src/services/project/session/csv_writes.rs`：表格暂存及成功应用后的正式接纳。
- `src/shared/types/project-identity.types.ts`：实体、目标和版本身份协议。

### 装配

- `src-tauri/src/services/mod.rs`：业务能力的直接导出。
- `src-tauri/src/services/project_save.rs`：所属项目队列和事务分派。

## 边界

- 实体写入持有实际内容、文件路径、关联表、描述、父引用及身份结果。
- 所属编辑动作决定本次提交的内容及明确关联动作。
- 项目会话持有正式表格、稳定行身份和来源版本。
- 保存事务持有根租约、版本核对、历史及失败恢复。
- 项目同步持有结果发布和接收方交付。
- 规格、文本、JSON 和联合编辑消费同一实体写入能力并维护所属草稿。

## 链路

### 实体写入

1. 保存动作捕获正式目标、版本、内容及文件名选择。
2. 项目保存队列准备当前内容，事务核对所属版本。
3. 实体能力暂存主文件、关联表、描述、索引及父引用。
4. JSON 原文确认完成后应用同根变更集。
5. 成功后接纳正式表格状态，返回实际内容及身份结果。
6. 事务登记历史和正式投影，项目同步发布实际结果。

## 规范

- 实体保存必须消费捕获的正式目标、内容和版本。
- 实体及关联文件必须共同进入所属同根变更集。
- 暂存必须交付候选内容和身份；正式表格接纳必须发生在变更集应用成功后。
- 规格构造必须消费所属模板并交付独立可编辑内容。
- CSV 关联覆盖必须优先采用 ID 匹配的本地、原版或引用原文件，缺少有效原内容才允许模板创建；读取已有目标必须保留目标文件原文及说明，CSV 内容必须独立保存。
- CSV 关联选择必须绑定实际来源、目标及同次读取版本，确认后变化必须结束提交；覆盖与本地旧文件移除必须共同支持一次撤销，外部来源只允许读取。
- 文件名选择必须归原动作的反馈寿命，取消必须结束本次写入。
- 描述改名必须共同核对实体种类、描述类别、原身份及目标冲突。
- 父装配引用修改必须消费实际本地文件和当前版本范围。
- 保存成功必须以实际文件、历史及正式内容登记结果判定。
