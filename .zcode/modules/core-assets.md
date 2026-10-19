# Core 索引与加载

## 定义

Core 索引与加载模块按游戏根管理字段和图形目录的独立读取与投影生命周期。

## 参考

### 拥有

- `src-tauri/src/commands/core_assets.rs`：Core command。
- `src/app/composables/use-core-assets.ts`：图形门面与显式根输入的窗口生命周期。
- `src/app/composables/use-core-schema.ts`：配置 schema 与当前 Core 字段的响应式合并门面。
- `src/orchestrators/core-assets.orchestrator.ts`：显式响应式根输入、根代次、共享 Promise、接纳与失败日志。
- `src/services/core-assets.service.ts`：Core 读取与缓存清理协议。
- `src/stores/core-assets.store.ts`：根与两类状态。

### 消费

- `src-tauri/src/models/core_assets.rs`：Core 扫描、失效请求与发现字段协议。
- `src-tauri/src/services/project/sources/core.rs`：按游戏根交付 Core 来源、字段、图形和文档缓存。
- `src/shared/types/core-assets.types.ts`：Core 扫描、失效请求与发现字段协议。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。
- `src/app/WindowShell.vue`：设置根优先、当前项目根回退的计算及唯一 Core 生命周期装配。

## 边界

- Core store 持有根、fields、graphics、各自状态和结构化错误。
- Core 来源 owner 持有规范化游戏根、产品代次、共享来源记录和各产品单飞任务。
- WindowShell 装配加载生命周期，工作区生命周期消费缓存清理能力。
- schema 合并归领域纯投影，编辑面消费静态 schema 与当前 Core 字段。
- 加载编排拥有根代次、共享 Promise、结果接纳与失败日志。
- 后端 Core 读取在缓存锁外执行，结果接纳前复核根和产品代次。
- 窗口壳提供响应式根输入，路径授权归后端；字体读取以所属 session 补充来源并由字体运行态消费逐项结果。

## 链路

### 读取与根变化

1. 窗口壳创建加载运行态与根监听。
2. 消费者请求所属资源，同根同代次复用 Promise。
3. 根变化清空投影并独立启动 fields 与 graphics。
4. 当前代次接纳值或错误，失败记录一次原始诊断。
5. 再次请求重试，窗口释放结束接纳权。

## 规范

- A-B-A、根清空及窗口释放必须通过代次撤销旧成功、错误和收尾。
- Core 根必须经正式根边界授权，严禁消费链接父链或逃逸路径。
- fields 与 graphics 必须独立就绪、加载和失败；一类失败严禁阻断另一类。
- 业务编辑草稿严禁写入 Core 加载运行态。
- 内存 Core 清理必须共同清理所属指纹缓存，持久化快照必须按根与源指纹校验。
- 加载运行态必须消费窗口交付的响应式根，首次读取必须由消费者触发，根变化必须独立启动字段和图形读取。
- 同类重复调用必须等待所属在途请求自然结束。
- 多窗口对同一游戏根的同类请求必须复用后端 Core 产品结果。
- 窗口生命周期与图形门面只允许消费 Core 运行态和加载能力；配置资产及字段合并必须由 schema 门面的消费者加载。

## 陷阱

- 失效响应写入新根状态会使 loading、错误和数据属于不同代次。
- 控件自建加载 owner 会使同根读取与根变化产生独立接纳顺序。
- 根清空后展示旧值会把已释放来源作为当前 Core 投影。
