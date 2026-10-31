# 杂项配置

## 定义

杂项配置模块提供已登记配置文件的目录、独立读取、创建、保存和删除能力。

## 参考

### 拥有

- `src-tauri/src/commands/misc_config.rs`：会话范围校验、根事务及正式提交。
- `src-tauri/src/domain/misc_config.rs`：文件种类、固定路径与所属内容校验。
- `src-tauri/src/services/misc_config.rs`：完整目录、逐文件读取、JSON 渲染与文件变更集。
- `src/services/misc-config.service.ts`：读取票据、路径失效和写入协议包装。

### 消费

- `schemas/engine-styles.schema.json`：引擎样式字段、初值及前后端共同校验依据。
- `schemas/game-settings.schema.json`：设计类型颜色及游戏设置各分组的字段定义。
- `schemas/hull-styles.schema.json`：船体样式字段、初值及前后端共同校验依据。
- `schemas/sounds.schema.json`：音效、声音组与音乐格式及字段定义。
- `src-tauri/src/domain/schema.rs`：字段结构、条件必填及分支约束校验。
- `src-tauri/src/io/`：路径授权、版本、JSON 原文保留与文件变更集。
- `src-tauri/src/json_overlay.rs`：有效配置校验前消费的公共 JSON 值覆盖纯运算。
- `src-tauri/src/models/document_identity.rs`：配置文件类别与文档来源身份。
- `src-tauri/src/models/misc_config.rs`：配置查询记录、保存与删除协议。
- `src-tauri/src/parsers/field_schema.rs`：内嵌字段资产读取。
- `src-tauri/src/services/write_transactions.rs`：根事务、版本校验、历史及提交同步。
- `src/domain/json-editor/misc-config-files.ts`：文件种类、用途、文件名、路径、表单、初始内容与文档投影。
- `src/services/query-cache.service.ts`：所属会话的实时读取与失效。
- `src/shared/types/misc-config.types.ts`：前后端对应的类型化文件协议。

### 装配

- `src/app/composables/json-editor/json-document-capabilities.ts`：文件表单、创建和保存能力装配。
- `src/domain/workspace/mod-navigation.ts`：描述文本下方的杂项配置入口。

## 边界

- JSON 文档会话拥有文件草稿、活动输入、撤销重做与保存登记。
- 后端提供全部登记文件的存在状态、所属错误与所选文件的内容和版本。
- 字段模式拥有各文件的独立内容定义、展示排列和集合编辑。
- 文件登记拥有可编辑种类、路径及所属校验规则。
- 杂项配置服务拥有目录、逐文件读取与变更集。
- 根事务拥有写入授权、文件历史、投影和回执。

## 链路

### 读取与编辑

1. 导航激活所属 session 与 Mod 的杂项配置页面。
2. `query_misc_config_files` 交付全部登记项、存在状态与所属检查错误，中栏按登记顺序显示并恢复选择。
3. 所选已有文件通过 `query_misc_config_file` 独立读取路径、JSON 值与版本；缺文件在右侧提供创建，错误在右侧提供重试与文件修复。
4. JSON 文档会话直接接纳本次内容与版本，消费所属文件投影与 schema，字段动作更新草稿，保存提交所属输入并捕获文档快照。

### 写入与回放

1. 新建准备缺失文件版本；保存和删除消费已读文件版本。
2. command 开始所属根事务，校验版本及文件种类对应的路径。
3. 服务渲染内容或删除文件，经变更集与正式提交登记文件历史。
4. 文档接纳实际保存基线，提交同步按实际路径刷新查询与列表。
5. 文件历史回放重新授权路径、核对版本并沿同一失效入口刷新。

## 规范

- 公开请求必须按文件种类选择后端登记路径，严禁接收任意文件路径。
- 创建必须取得目标不存在的版本凭据，初始内容必须消费所属文件定义；创建和主动删除必须保留文件条目及选择。
- 失效匹配必须统一使用后端交付的正式路径身份。
- 已访问来源删除时必须保留草稿，并消费 JSON 来源缺失提示与重建动作。
- 当前登记必须按 `strings`、`engineStyles`、`hullStyles`、`sounds`、`settings` 排序，路径与表单必须消费所属定义。
- 所有写动作必须消费所属 session、Mod 和版本，经根事务、JSON 写入确认及正式回执交接。
- 文件身份必须独立于 JSON 内容，严禁向内容写入实体 ID。
- 新增文件种类必须分别登记用途、文件名、路径、表单、初始内容与内容校验，模块请求必须保持文件种类身份。
- 样式与声音保存必须按当前 Mod 覆盖原版后的内容校验完整性，实际写盘必须保留所属草稿的局部覆盖形态。
- 样式新增必须采用已登记的完整初值并检查保留名称；读取和保存必须保留合法局部覆盖及未知字段。
- 目录与内容必须分别消费正式读取票据和路径失效；错误与迟到结果必须按文件、session、Mod 和请求接纳。
- 缺失文件只允许通过创建动作建立正式文档与版本。
- 船体样式的声音组引用与声音组的船体样式规则必须消费字段来源目录，设计类型颜色名称必须交付所属引用字段。
- 表单与后端内容校验必须共同消费所属资产的 `root` 定义；表单必须复用字段模式的固定属性、可命名条目、列表、额外字段与编辑模式规则。
- 配置一级对象必须分别展示为可折叠分组，设置的 `designTypeColors`、`graphics` 与 `plugins` 必须作为保留分组，其余值必须服从所属 schema 的 allowExtraFields 声明；Smart 模式只允许显式开放的扩展区展示且空内容必须保留入口，已登记字段必须使用所属控件。
- 音乐单文件与文件列表必须按互斥字段提交；声音选择索引必须按合并后音频列表的实际长度校验。
- 音效数组、声音组对象及音乐目录必须按实际结构编辑，音频文件名必须消费所属 Mod 根或音乐来源的路径含义。
