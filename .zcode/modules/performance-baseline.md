# 性能基线

## 定义

性能基线模块记录正式业务链路的耗时与规模，并提供可复现比较依据。

## 参考

`src-tauri/src/services/project/performance.rs`：后端 ProjectSession 阶段打点 owner。
`src/app/composables/config/use-config-family-view-model.ts`：配置列表首帧打点消费方。
`src/app/composables/tables/use-csv-table-view-model.ts`：source 目录与查询缓存打点消费方。
`src/app/composables/use-performance-logger.ts`：业务打点 hook。
`src/services/app-log.service.ts`：日志 sink 的接收交接能力，启动时显式注册。
`src/services/resource-media.service.ts`：可视区媒体批次打点消费方。
`src/shared/runtime/performance.ts`：性能记录 owner，拥有计时格式化、记录入口与可注入日志 sink。

## 边界

- 各窗口启动装配日志 sink，应用日志能力拥有持久化、级别和脱敏。
- 后端 ProjectSession 提供打开阶段 trace，前端能力记录调用及展示阶段。
- 基线数据描述同一环境和操作场景的观测结果，比较方法以完整样本统计为依据。
- 性能原语拥有计时、记录格式与可注入 sink，业务入口提供阶段和规模。
- 性能观测消费正式业务入口，其状态与保存结果仍由业务 owner 接纳。

## 链路

### 业务阶段计时

1. 业务入口经 hook 或性能原语捕获开始时间。
2. 正式动作执行后取得结果和规模字段。
3. 性能原语在动作结束处计算耗时并交付记录。

### 后端打开 trace

1. ProjectSession 打开建立阶段 trace。
2. 根、索引、持久化缓存和 manifest 装配记录各阶段耗时。
3. service 返回完整 trace，前端打开能力交付后端阶段及 invoke 耗时。

### 日志接纳

1. `recordPerformance` 将名称、毫秒值和阶段字段装配为结构化条目。
2. 注入 sink 将条目交给应用日志能力。
3. 后端日志按已保存级别过滤、渲染并写入。

## 规范

- 性能比较必须固定 Mod、构建、环境与操作脚本，并报告输入规模、样本数、最小值、最大值、平均值、中位数及 nearest-rank P95；差异必须同时表达绝对值与百分比。
- 打点只允许观测正式入口，严禁改变布局、渲染、保存或 query 语义。
- 打点必须消费所属入口的稳定名称和结构化字段，阶段、规模和毫秒值必须共同交付日志 sink。
- 打点日志必须进入应用日志链路并遵守其分级与脱敏约束；性能打点为 DEBUG 级，仅在日志级别切至详细（DEBUG）档时落盘，性能采样前必须先切换详细档。
- 打点条目必须采用稳定码 `perf`、message `PERF <名称>`、`fields` 携带 `ms` 与阶段参数；后端 `project.openSession` trace 同格式，`stage=total` 条目携带 `modRoot`，其余条目 `stage=<阶段名>`。
- 日志 sink 未注册时打点必须静默丢弃，严禁报错。
- 首帧计时必须从所属列表加载开始，到实体行挂载后的下一 animation frame 结束；媒体记录必须同时提供请求、命中、成功和失败规模。

## 陷阱

- 为采样改变加载或渲染行为会让基线失去可比性。
- 在业务链路内联计时逻辑会让观测代码随业务分叉。
- 打点进入 error 级别日志会把观测污染成失败信号。
- 用单次采样下结论会把噪声当成回归。
