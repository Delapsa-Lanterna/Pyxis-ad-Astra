# 项目查询与缓存

## 定义

项目查询与缓存模块按会话执行类型化查询并管理共享读取、缓存与失效通知。

## 参考

### 拥有

- `src/services/query-cache.service.ts`：类型化缓存实例、共享请求、即时读取、门控及失效通知。
- `src/services/query-cache.spec.ts`：参数类型、请求共享、门控、失效、零预算及迟到结果验证。

### 消费

- `src/services/project-projection.service.ts`：缓存命中、加载及完成时的会话投影门控。
- `src/shared/lib/stable-compare.ts`：查询参数的稳定序列化。
- `src/shared/runtime/app-log-queue.ts`：查询开始、完成、命中、共享和失效的详细记录。
- `src/shared/runtime/cache-limits.ts`：各缓存消费的窗口启动预算。
- `src/shared/runtime/cache.ts`：类型化 LRU 与 pending 存储。
- `src/shared/runtime/read-request.ts`：正式票据、失效与消费者等待。
- `src/shared/types/cache-limits.types.ts`：缓存查询预算键。
- `src/shared/types/json.types.ts`：结果的深度只读投影。
- `src/shared/types/project-session.types.ts`：标准会话失效协议。
- `src/shared/types/query-cache.types.ts`：捕获 session、查询名称与参数的泛型身份。

### 装配

- `src/orchestrators/project-sync.orchestrator.ts`：正式项目失效的交付。
- `src/orchestrators/workspace-lifecycle.orchestrator.ts`：关闭 session 时结束所属查询与缓存。

## 边界

- 各业务定义拥有参数、返回、加载与失效规则，缓存消费明确的类型化定义。
- 同一缓存查询定义持有类型化结果与在途请求，实时查询集合持有所属票据。
- 完整查询身份由 session、查询名称和参数构成，加载函数消费捕获身份。
- 投影门控由项目会话拥有，容量消费公共预算的窗口启动快照。
- 读取 owner 拥有展示通道，基础缓存拥有共享在途请求和就绪保留。
- 项目同步拥有失效发起与内容变化交接，缓存通知归缓存及读取生命周期。

## 链路

### 定义与读取

1. 所属业务在模块加载时建立缓存实例或即时查询定义。
2. 消费者向缓存实例的 read 方法或即时读取入口交付 session、参数及所属等待信号。
3. 会话读取捕获独立参数快照并检查投影门控。
4. 缓存命中、共享在途请求或执行定义中的 loader。
5. 结果按票据及当前门控接纳，交付深度只读值并结束 pending。

### 失效与释放

1. 项目同步或关闭入口交付所属 session 与正式失效。
2. 缓存依据查询定义判断实际条目，实时集合判断所属请求。
3. 匹配票据立即结束等待，替代条目保持自己的 pending 和结果。
4. 缓存通知结束所属内部生命周期，正式结果交付后由内容维护者决定接纳或读取。

## 规范

- 单个查询定义必须固定参数和结果类型，业务读取必须在所属 service 建立一次定义。
- 参数必须只捕获一次独立快照，缓存键、loader 及失效判断必须共同消费该快照。
- 同一身份的在途缓存请求必须共享一次加载，消费者释放必须只结束自己的等待。
- 失效必须立即结束票据并保留捕获身份与结束原因，底层请求必须自然结束。
- 待同步投影必须在缓存命中、请求开始及完成接纳前检查，当前草稿必须由所属编辑会话交接。
- 查询失败必须释放 pending，下一次读取必须重新执行所属 loader。
- 查询容量必须消费所属启动预算，零容量必须保留在途共享并关闭就绪保留。
- 查询结果必须通过 DeepReadonly 交付，可写快照必须由正式独立快照入口创建。
- 查询详细记录必须保留 queryKind、session、缓存结果和完成状态，参数及结果正文严禁进入日志。
- 缓存与查询身份协议必须只表达公共会话读取，业务字段与失效语义必须由所属定义交付。
- 迟到成功、错误和收尾必须服从正式票据，替代请求的缓存及 pending 必须保持实际归属。
