# 项目查询与缓存

## 定义

项目查询与缓存模块提供按会话隔离的实体读取与查询生命周期。

## 参考

`src-tauri/src/commands/entity_query.rs`：实体读取 command 的参数及返回模型主归属。
`src/app/composables/use-query-read-owner.ts`：`ReadTicket` 消费者等待、请求通道与释放主归属。
`src/services/entity-query.service.ts`：详情、列表、实际目标、身份意图及草稿资源能力主归属。
`src/services/project-projection.service.ts`：查询与媒体读取共同消费的会话投影门控。
`src/services/query-cache.service.ts`：八类缓存、single-flight、失效匹配与实时读取 owner。
`src/shared/lib/query-snapshot.ts`：只读记录到所属独立可写快照的交接。
`src/shared/runtime/cache.ts`：类型化 LRU 与 `pending` 原语主归属。
`src/shared/runtime/read-request.ts`：请求失效、消费者等待与错误主归属。
`src/shared/types/query-cache.types.ts`：`queryKind`、参数、返回类型及深度只读模型主归属。

## 边界

- ProjectSession 刷新编排消费项目失效，工作区生命周期消费会话清理。
- `ReadTicket` 同时持有 query identity、AbortSignal、Promise、接纳状态与结束原因。
- query-cache 拥有缓存、single-flight、失效与通知，读取 owner 拥有消费者等待和接纳通道。
- 各配置、表格、编辑器和保存准备边界复制内容、目标及版本到所属草稿。
- 实体能力拥有类型化参数与返回模型，领域 mapper 把只读记录交付独立可写快照。
- 展示值、错误和收尾由通道回调发布，后续动作消费返回的接纳结果。
- 类型化 query 固定参数与返回关联，共享存储在内部边界处理类型擦除。

## 链路

### 实体及目标读取

1. 配置、编辑器或保存准备捕获 session 与实体身份。
2. entity-query 装配 command 与 payload，经 `command.runtime` 调用 Rust query。
3. 详情或列表消费所属缓存，目标、身份意图及草稿资源消费实时请求。
4. mapper 或编辑会话复制内容、目标和版本，按捕获票据接纳。

### 缓存与消费者生命周期

1. 所属读取能力构造 session、`queryKind` 和参数。
2. query-cache 命中缓存、合并在途请求或建立正式请求。
3. 请求完成后发布只读结果并释放 `pending`。
4. 项目失效或会话清理撤销请求并通知所属消费者。
5. 有效消费者重读当前目标，目标切换或卸载释放等待。

## 规范

- `RuntimeCache` 必须在创建时固定 key、value 和 `pending` 类型；`get/set` 必须更新访问顺序，peek/has/遍历必须保留顺序。
- 候选详情必须使用独立 `ReadTicket`，列表媒体必须消费可视集合；目标替换、失效与关闭必须撤销所属接纳权。
- 单通道撤销只允许清理所属票据与调度；目标清空必须撤销所属读取，多通道释放必须保持其他通道的待执行刷新。
- 失效必须立即结束等待并提供 query.invalidated、捕获身份和结束原因，底层请求必须自然完成。
- 实体列表必须在单次列表查询内准备来源、关联记录和版本；列表结果严禁逐实体重新读取索引或目标。
- 实时查询参数必须在 `queryLive` 捕获一次独立快照，所属 loader 必须消费该捕获身份装配 command；草稿资源调用方只允许提交当前正式草稿。
- 待同步投影必须在缓存命中与读取之前检查，当前草稿必须保持现行基线交接规则。
- 手动来源刷新必须沿正式项目失效结果更新查询及媒体，跨窗口接纳必须核对 session 和投影版本。
- 查询失败必须释放 `pending`，下一次读取必须重新执行所属 loader。
- 查询容量必须消费 settings 的对应启动预算，零值只允许关闭就绪保留并保持在途去重；缓存键必须包含 session，CSV 窗口身份必须包含 table、start、count、`search` 与 `searchField`。
- 查询结果必须通过深度只读类型公开，可写快照必须具有独立嵌套内容和版本数组。
- 正常生命周期失效必须由 `ReadTicket` owner 消费，真实错误必须进入所属反馈。
- 消费者释放只允许结束自己的等待，共享在途请求必须继续服务其它消费者。
- 联合基线、草稿关联与三方准备必须使用实时票据，参数必须捕获独立快照；引用替换与会话失效必须结束原等待。
- 联合目录与候选详情必须按完整 root 和查询种类缓存并共享在途读取，正式基线必须由编辑会话接纳。
- 联合配置、资源与字段投影必须共同保留 Core／Mod 来源版本；来源失效必须重读实际依赖。
- 迟到成功、错误和收尾必须由 `ReadTicket` 的接纳状态核对；替代请求的 `pending` 与缓存必须保持正式归属。

## 陷阱

- 单个消费者撤销共享请求会使其他有效等待同时失效。
- 无关参数字典搭配任意返回泛型会让 query identity 与缓存值失去类型关联。
- 缓存和草稿共享嵌套对象会让本地编辑污染只读查询结果。
