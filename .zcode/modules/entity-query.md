# 实体查询

## 定义

实体查询模块交付实体详情、列表、实际编辑目标与身份意图。

## 参考

### 拥有

- `src-tauri/src/commands/entity_query.rs`：实体、目标及身份意图查询 command。
- `src-tauri/src/domain/json_composition.rs`：游戏同路径 JSON 的纯合并规则。
- `src-tauri/src/services/project/query/entities.rs`：按实际来源装配详情与列表。
- `src-tauri/src/services/project/query/entity_targets.rs`：实际编辑目标、身份意图及正式版本范围。
- `src-tauri/src/services/project/query/json_composition.rs`：有序同路径来源、版本、加载规则与资源归属。
- `src/services/entity-query.service.ts`：四类查询定义、正式请求与实体失效选择。

### 消费

- `src-tauri/src/models/entity_query.rs`：实体详情、列表请求及返回记录。
- `src/domain/project/query-scopes.ts`：标准实体失效 scope 匹配。
- `src/services/query-cache.service.ts`：会话缓存、实时请求与失效通知。
- `src/shared/types/entity-query.types.ts`：与 Rust 对应的实体请求与返回协议。
- `src/shared/types/project-identity.types.ts`：实体、目标、版本及身份意图协议。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。

## 边界

- 后端按登记的实体种类和实际来源交付只读内容、目标与版本。
- 实体列表一次准备实际来源和关联记录，前端业务 mapper 交付所属可写快照。
- 实体查询拥有参数、返回和失效规则，会话缓存拥有共享请求和就绪结果。
- 实际编辑目标与身份意图通过实时查询交付，详情与列表消费各自缓存。
- 读取接纳归正式票据，资源引用按实体来源由所属资源能力构造。

## 链路

### 查询

1. 消费者捕获 session、实体种类与 ID。
2. 正式查询定义固定参数、返回、加载与失效规则。
3. 会话读取捕获参数快照并经 command 调用对应 Rust query。
4. 消费者按票据接纳只读记录或交接独立可写快照。

### 失效

1. 项目同步交付标准失效 scope。
2. 实体种类及 ID 匹配结束所属详情、列表或目标读取。
3. 身份意图共同核对源与目标 ID，消费者按所属通道重读。

## 规范

- 合并预览必须按原版、前序可引用 Mod、本地内容的顺序计算；实体列表只允许展示本地文件。
- 查询必须分别交付本地内容与已保存的引用来源；本地缺省 ID 必须从文件名推断，游戏身份必须从合并结果读取。
- 同路径合并必须消费游戏的数组追加、首项清空标记、颜色与音乐数组、类型冲突、replace 声明及设置字段排除规则；补充层标量必须保留写入类型。
- 是否参与同路径组合必须由 `entity_composition` 统一判定：本 Mod 来源且经游戏 `readJSON` 加载的实体文件参与组合，装配包含在内；`loadJSON` 读取的 `mod_info.json` 与战役 `descriptor.json` 不参与。
- Rust 对外实体查询和版本范围核对必须消费服务装配的正式函数入口，内部来源读取必须复用会话能力。
- 实体列表必须在一次查询内装配来源和关联记录，严禁逐实体重读索引或目标。
- 实体列表必须消费所属登记来源。
- 实体失效必须核对种类及 ID，空 ID scope 必须作用于所属种类。
- 实体目标和身份意图必须消费实时票据，身份意图必须覆盖源与目标的变化。
- 实体请求与返回必须在两端对应，实际目标、身份意图与版本必须由所属后端正式查询或准备入口交付；前端严禁通过扫描或拼接路径构造实体目标。
- 所有查询必须消费捕获的参数快照，迟到结果必须服从所属 session 与读取票据。
- 来源内容与版本必须共同接纳，任务正文读取必须共同更新所属目录凭据。
- 查询结果必须通过深度只读类型交付，草稿必须具有独立内容与版本数组。
- 身份意图的使用必须在正式提交时复核当前版本。
