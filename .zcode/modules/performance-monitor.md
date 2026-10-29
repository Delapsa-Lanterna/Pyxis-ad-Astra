# 性能监视

## 定义

性能监视模块采集正式应用执行与浏览器事件并提供独立时间线报告及 CPU 采样。

## 参考

### 拥有

- `scripts/performance/profile.mjs`：连接已运行应用的 DevTools endpoint，采集并导出 CPU profile。
- `src-tauri/command-macros/`：命令声明与登记的计时调用生成。
- `src-tauri/src/commands/performance_monitor.rs`：批量交付及状态、重置、导出命令。
- `src-tauri/src/services/command_timing_tests.rs`：命令生成、实际完成、身份与停用验证。
- `src-tauri/src/services/performance_monitor.rs`：命令计时、环形缓冲与报告导出。
- `src-tauri/src/services/performance_monitor_tests.rs`：容量、统计、正文过滤、文件与异步区间验证。
- `src-tauri/src/services/project/performance.rs`：ProjectSession 阶段计时。
- `src/app/performance-monitor.spec.ts`：采集启停、自动动作、批次与失败保留验证。
- `src/app/performance-monitor.ts`：窗口采集装配、批量交付与采集错误状态。
- `src/services/performance-monitor.service.ts`：性能监视命令参数装配。

### 消费

- `src-tauri/src/models/performance_monitor.rs`：性能采样与报告状态协议。
- `src/shared/runtime/performance.ts`：运行开关、区间计时与采样接收入口。
- `src/shared/types/performance-monitor.types.ts`：批量交付与状态协议。

### 装配

- `src-tauri/src/commands/app_lifecycle.rs`：正式设置接纳与运行开关固定。
- `src-tauri/src/lib.rs`：统一命令登记与计时调用装配。
- `src/app/components/SettingsPage.vue`：日志分组下方的性能调试入口。
- `src/app/composables/use-app-lifecycle-assembly.ts`：正常关闭时交付所属尾批。
- `src/main.ts`：业务挂载前的监视装配。
- `src/services/query-cache.service.ts`：查询等待及命中状态采集。
- `src/shared/runtime/command.runtime.ts`：IPC 往返采集与请求身份 header。

## 边界

- 前后端共享本次运行的有效开关，由正式设置首次接纳固定；保存的修改在重启后生效。
- 前端拥有所属窗口的采集设施和待交付记录，后端拥有共享缓冲及报告文件。
- 前端窗口缓冲容量为 2048 条，每秒交付，每批最多 512 条；后端容量为 50000 条。缓冲保留最近记录并累计覆盖数量，交付失败保留待交付记录。
- 性能文件位于工具 app-data 的 performance-monitor 目录；业务状态与保存接纳仍归所属 owner。
- 报告按来源及名称分别统计，包含标准完整区间事件、环境信息、窗口最后交付时间与覆盖数量。重置以新的开始时间过滤旧区间。

## 链路

### 自动采集

1. 正式设置交付已保存及本次运行开关，启用窗口在业务挂载前装配采集设施。
2. IPC、查询与 action 在共同入口计时；Rust 由命令生成调用取得名称、窗口与请求身份，在参数接纳后开始并在实际执行结束时交付耗时。
3. 窗口记录批量交付后端，受控关闭必须经窗口关闭握手在销毁前交付性能尾批。

### 报告导出

1. 设置动作先交付当前窗口记录，再请求后端导出。
2. 后端生成已收集数据的时间线与统计，写入 JSON 文件并返回实际路径。

### 外部 CPU 采样

1. 采样脚本连接已运行应用的 DevTools endpoint，定位所属页面。
2. 开启 Profiler，按指定时长采集 CPU profile。
3. 导出 cpuprofile，关闭采样及所属连接。

## 规范

- IPC、后端执行与界面完成的计时必须分别表达所属阶段。
- 子窗口销毁前必须经关闭握手完成性能尾批交付；交付失败必须保留监视错误并继续关闭。
- 性能监视必须默认关闭；关闭时严禁建立采集设施、读取采样时钟或组装采样字段。
- 性能记录严禁写入应用日志，请求与响应正文严禁进入基础采样。
- 批量交付必须保持单次在途；采集设施必须随所属窗口释放。
- 观测严禁改变业务、查询或展示语义；新增 command、查询与 action 必须由共同入口自动采集。
- 项目命令必须使用共同 command 声明与 generate_handler 登记；原函数必须保留业务签名，异步计时必须覆盖实际等待，运行时严禁启用 tauri/tracing。
