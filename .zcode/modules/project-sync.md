# 项目同步

## 定义

项目同步模块协调保存与来源刷新的结果接纳、缓存失效、恢复重试及窗口通知。

## 参考

### 拥有

- `src-tauri/src/commands/project_sync.rs`：按变更刷新、来源刷新与指定提交恢复 command。
- `src/app/components/WriteSyncNotice.vue`：待同步提交及重试状态展示。
- `src/app/components/write-sync-notice.spec.ts`：同步提示与重试反馈验证。
- `src/app/composables/use-write-sync-view-model.ts`：待同步提交重试、执行状态与窗口反馈。
- `src/orchestrators/committed-write-events.spec.ts`：文本与规格对正式提交通知的业务投影验证。
- `src/orchestrators/project-sync.orchestrator.spec.ts`：保存及来源刷新的接纳、顺序、去重与释放验证。
- `src/orchestrators/project-sync.orchestrator.ts`：保存及来源刷新接纳、缓存失效、恢复重试与窗口通知。
- `src/services/project-sync.service.ts`：三个同步请求的类型化跨端交付。
- `src/stores/project-sync.store.ts`：待同步提交、步骤、错误及提交与投影缓存失效记录。

### 消费

- `src-tauri/src/models/project_session.rs`：会话刷新请求与完整投影结果。
- `src-tauri/src/models/write_commit.rs`：保存回执与指定提交恢复请求。
- `src-tauri/src/services/project/mod.rs`：正式会话刷新能力。
- `src-tauri/src/services/write_transactions.rs`：指定提交恢复能力。
- `src/services/project-projection.service.ts`：pending 提交对应的读取门控。
- `src/services/query-cache.service.ts`：查询缓存失效与 session 等待结束信号。
- `src/services/resource-media.service.ts`：所属资源缓存失效。
- `src/shared/types/project-session.types.ts`：与 Rust 对应的刷新请求及投影结果。
- `src/shared/types/write-commit.types.ts`：保存回执、通知与指定提交恢复请求。
- `src/stores/file-history.store.ts`：历史摘要投影。
- `src/stores/project.store.ts`：正式清单与单调投影版本。
- `src/windows/tauri.events.ts`：窗口事件监听与发送。

### 装配

- `src/orchestrators/workspace-lifecycle.orchestrator.ts`：关闭前重试与所属 Mod、session 同步状态释放。

## 边界

- 保存提交和来源刷新共同消费正式投影接纳及缓存失效流程。
- 同步运行态按窗口拥有，待同步提交和完成记录按 Mod 根释放，投影失效记录按 session 释放。
- 同步重试消费原提交及当前步骤，窗口反馈消费实际完成结果。
- 正式清单、投影版本与读取门控归项目会话，缓存内容归所属查询及资源能力。
- 窗口事件交接拥有订阅者、进行中的交付及身份和普通投影阶段。
- 资源缓存先于查询缓存失效，通知交付已经完成的本地接纳结果。

## 链路

### 保存后同步

1. 业务入口接纳实际保存基线并交付完整回执。
2. 项目同步接纳历史摘要，按原提交恢复 pending 投影。
3. 接纳正式清单并先后失效资源缓存与查询缓存。
4. 完成本地接纳后广播提交事件，失败保留当前步骤。

### 来源刷新

1. 所属入口捕获 session、Mod 根与来源路径。
2. 类型化 service 和对应 Rust command 交付正式来源刷新。
3. session 有效时接纳清单、失效缓存并广播来源结果。
4. 发起页面按所属读取接纳权更新展示。

### 接收与释放

1. 接收窗口按来源窗口、session、Mod 根与提交 ID 筛选通知。
2. 正式接纳及缓存失效完成后执行身份处理，再交付普通投影订阅者。
3. 消费者释放所属订阅，最后一个提交订阅者释放底层监听。
4. Mod 关闭等待所属同步，完成后释放提交记录和所属 session 的投影失效记录。

## 规范

- 前后端同步请求必须消费成对类型，字段、显式 null 和默认值必须共同核对。
- 同一提交的并发发布和接收必须共享进行中的 Promise，成功交付必须按订阅者去重。
- 同步失败必须保留原回执、诊断及未完成步骤，重试严禁重复业务写入或磁盘回放。
- 提交接纳必须消费实际历史摘要与单调投影，当前草稿必须由所属编辑器交接。
- 来源刷新完成事件必须交付来源游戏根与失效资源路径，Core 窗口生命周期必须按该范围更新所属产品。
- 来源刷新必须按捕获 session 的寿命完成正式接纳，页面切换必须保留已经执行的同步动作。
- 窗口反馈必须消费所属动作的终结结果，失败记录必须保留原稳定码和诊断。
- 窗口通知必须先完成正式接纳及资源、查询缓存失效；关闭准备必须保留展示通知，取消时必须按身份先于投影的顺序补交付。
- 缓存失效记录必须按 session 和投影版本去重，所属 Mod 释放必须同时清理提交与投影记录。
- 读取门控必须随所属提交状态推进，迟到成功、错误及收尾严禁写入替换后的 session。

## 陷阱

- 严禁以一个订阅者释放结束其它订阅者的等待，监听必须按实际订阅集合释放。
- 严禁在广播失败时重做已完成的本地接纳，重试必须继续当前步骤。
- 严禁按页面寿命结束已经执行的来源同步，结果必须由所属 session 接纳。
