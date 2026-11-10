# Core 索引与加载

## 定义

Core 索引与加载模块按游戏根管理字段和图形目录的独立读取与投影生命周期。

## 参考

### 拥有

- `src-tauri/src/commands/core_assets.rs`：Core command。
- `src-tauri/src/services/project/resources/core_assets.rs`：有效 Core 根选择与字段和图形产品查询。
- `src/app/composables/use-core-assets.ts`：图形门面与显式根输入的窗口生命周期。
- `src/app/composables/use-core-schema.ts`：配置 schema 与当前 Core 字段的响应式合并门面。
- `src/orchestrators/core-assets.orchestrator.ts`：显式响应式根输入、根代次、共享 Promise、接纳与失败日志。
- `src/services/core-assets.service.ts`：Core 读取与缓存清理协议。
- `src/stores/core-assets.store.ts`：根与两类状态。

### 消费

- `src-tauri/src/models/core_assets.rs`：Core 扫描、失效请求与发现字段协议。
- `src-tauri/src/services/app_settings.rs`：正式快照、revision、串行写盘、目录回调结果接纳及装配传入的运行参数提交动作。
- `src-tauri/src/services/project/session.rs`：会话打开、关闭、内容更新与内部登记及就绪访问能力交付。
- `src-tauri/src/services/project/session/`：会话授权、就绪访问、CSV 正式内容、引用及来源版本管理。
- `src-tauri/src/services/project/sources/`：授权来源发现、带版本读取、Core 共享成果及规格文档装载。
- `src-tauri/src/services/project_sync.rs`：窗口 Core 根订阅与独立变化交付。
- `src-tauri/src/services/project_sync/source_changes.rs`：根订阅角色与寿命、来源状态、合并批次、后台排队及 Core 分发。
- `src/domain/schema/`：字段与列资产加载、游戏数字解释、来源声明、校验及目标格式准备。
- `src/orchestrators/project-sync.orchestrator.ts`：窗口内保存消费过程和内容维护者交接。
- `src/orchestrators/window-event-errors.orchestrator.ts`：窗口事件失败的统一反馈交接。
- `src/shared/types/core-assets.types.ts`：Core 扫描、失效请求与发现字段协议。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。
- `src/app/WindowShell.vue`：所属会话与工作区上下文交付及唯一 Core 生命周期装配。

## 边界

- Core store 持有根、fields、graphics、各自状态和结构化错误。
- Core 来源 owner 持有规范化游戏根、产品代次、共享来源记录和各产品单飞任务。
- WindowShell 装配加载生命周期，工作区生命周期消费缓存清理能力。
- schema 合并归领域纯投影，编辑面消费静态 schema 与当前 Core 字段。
- 加载编排拥有根代次、共享 Promise、结果接纳与失败日志。
- 产品初读等待窗口根订阅就绪，自动与显式刷新共用产品任务装配，各产品分别接纳成功或失败。
- 后端 Core 读取在缓存锁外执行，结果接纳前复核根和产品代次。
- 窗口壳交付所属会话或工作区上下文，加载门面共享一次后端有效根确认并交付只读根及所属等待，同一规范根保留产品状态与在途任务；字体消费所属 session 来源。

## 链路

### 读取与根变化

1. 窗口壳创建加载运行态与根监听。
2. 消费者请求所属资源，同根同代次复用 Promise。
3. 后端有效根按规范路径比较，实际根变化时清空投影并独立启动 fields 与 graphics。
4. 当前代次接纳值或错误，失败记录一次原始诊断。
5. 再次请求重试，窗口释放结束接纳权。

## 规范

- fields 与 graphics 必须独立就绪、加载和失败；一类失败严禁阻断另一类。
- 内存 Core 清理必须共同清理所属指纹缓存，持久化快照按根与源指纹校验。
- 加载运行态消费窗口交付的响应式根，首次读取由消费者触发；上下文重解算为同一规范根时复用产品状态及在途任务，实际根变化时切换代次并独立读取字段和图形。
- 有效根读取失败必须清空当前投影、记录原始诊断并向所属等待交付空根；返回空根必须清空当前投影，上下文替换或窗口释放必须结束旧等待。
- 多窗口对同一游戏根的同类请求必须复用后端 Core 产品结果。
- 无项目会话的原版刷新必须消费所属根缓存清理和字段、图形加载能力，缓存清理等待后的加载复核窗口、根与产品代次。
- 显式来源刷新必须按游戏根及 Core 路径分别重载字段和图形，保留已有展示直到新结果接纳，失败允许重试。
- Core 字段与规格读取必须覆盖所属实体定义的全部来源目录；任一来源目录刷新失效对应产品的缓存。
- 窗口必须按实际 Core 根交还独立监听订阅，自动变化消费独立根通知并覆盖尚未打开 Mod 的窗口。
