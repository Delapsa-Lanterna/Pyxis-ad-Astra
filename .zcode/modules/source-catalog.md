# 来源候选目录

## 定义

来源候选目录模块按项目来源交付字段引用、实体、配置、图片及标签模板的候选目录。

## 参考

### 拥有

- `schemas/well-known-labels.json`：原版候选 tags、hints、UI 标签及数字模板元数据。
- `src-tauri/src/commands/source_catalog.rs`：字段候选与图片目录查询 command。
- `src-tauri/src/domain/well_known_labels.rs`：候选已知值、范围标签与数字模板的纯目录。
- `src-tauri/src/services/project/query/source_catalog.rs`：候选查询的所属职责模块登记。
- `src-tauri/src/services/project/query/source_catalog/`：值候选、配置来源登记、图片目录、来源分组与标签元数据查询。
- `src/domain/source-catalog/`：候选来源名称、配置路径及 CSV 来源解析。
- `src/services/source-catalog.service.ts`：正式查询参数、缓存身份、实时图片读取和所属失效。

### 消费

- `src-tauri/src/models/source_catalog.rs`：候选请求、选项、来源分组及模板的公共协议。
- `src-tauri/src/services/project/definitions/entity_definitions.rs`：实体来源和列表定义。
- `src-tauri/src/services/project/model.rs`：会话内容、EntityListEntry、表格定义及引用视图。
- `src-tauri/src/services/project/resources/`：候选名称、船体引用与授权图片投影。
- `src-tauri/src/services/project/session/`：会话就绪、正式行、引用快照与稳定身份。
- `src-tauri/src/services/project/sources/`：对应来源的内容、版本、Core 文档及配置读取。
- `src/services/query-cache.service.ts`：候选读取的会话缓存、实时请求与读取就绪门控。
- `src/shared/types/source-catalog.types.ts`：候选请求、选项、来源分组和模板协议。

### 装配

- `src-tauri/src/commands/mod.rs`：正式 command 登记及导出。
- `src-tauri/src/services/mod.rs`：直接从实际查询实现导出正式能力。
- `src-tauri/src/services/project/query/mod.rs`：只读业务实现登记。

## 边界

- 字段定义、列序及控件由 schema 维护，目录读取交付当前项目实际可用候选。
- 候选查询拥有范围、来源优先级、去重、分组、标签与资源投影。
- 会话拥有授权根、正式内容及引用顺序，候选查询消费捕获的就绪状态。
- 通用查询框架拥有共享任务与缓存，业务查询定义拥有身份和失效条件。
- 已知值资产按表列交付标签和模板，动态蓝图标签来自实际项目内容。
- 候选来源名称、配置文件及对象分组归目录登记，配置失效由目录解释实际资源变化。
- 图片目录读取捕获所属根并执行路径授权，只交付实际路径元数据。

## 链路

### 候选读取

1. 消费者捕获 session 与 source 或明确目录范围。
2. 类型化服务选择候选缓存或实时图片请求，经原 command 交付后端。
3. 后端捕获引用、取得就绪会话并读取实际表格、实体、配置或图片来源。
4. 目录按本地、标签顺序中的可引用 Mod、原版分组并去重，装配名称、资源与标签模板。
5. 消费者按所属票据接纳结果，项目资源变化经目录判定失效，字段刷新与缓存共同结束所属等待并重读。

## 规范

- 候选请求必须使用捕获的 session、source 或明确目录范围，结果必须服从同一读取票据。
- 目录必须按本地、有序引用 Mod、原版的优先级去重；来源身份、完整候选值及实际顺序必须保留。
- CSV 来源必须只消费正式非注释记录，非 ID 多值必须按原分隔规则交付。
- 授权图片必须通过正式资源能力投影，图片目录查询只允许返回路径元数据。
- 已知值和数字模板必须按表列隔离，动态标签必须消费实际来源内容。
- 候选失效必须共同消费正式 query scope 与配置资源范围，缓存和字段刷新必须调用同一判定，实时读取必须沿所属框架结束等待。
- 查询只允许读取，文件写入与正式状态接纳必须由所属业务维护者执行。
