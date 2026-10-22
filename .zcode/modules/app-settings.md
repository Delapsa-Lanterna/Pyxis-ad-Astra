# 应用设置与主题

## 定义

应用设置与主题模块管理工具设置、主题和各窗口的设置一致性。

## 参考

### 拥有

- `src-tauri/src/commands/app_settings.rs`：只允许承载字体目录 command。
- `src-tauri/src/services/app_settings.rs`：必须持有正式快照、revision、串行写盘及装配传入的运行参数提交动作。
- `src-tauri/src/services/app_settings/`：系统字体枚举及设置所属依赖。
- `src-tauri/src/services/app_settings/system_fonts.rs`：Windows 已安装字体族枚举、去重与排序。
- `src/app/components/SettingsPage.vue`：设置页组件，消费全局历史限制、日志留存与 accent 预设。
- `src/app/composables/settings/use-settings-view-model.ts`：字体与日志状态读取票据、页面投影及日志维护动作。
- `src/app/composables/settings/use-theme-dom-effect.ts`：主题与通用字体 DOM 副作用，写 root dataset、颜色变量与字体变量。
- `src/domain/settings/`：设置校验、字体、配色与主题令牌纯规则。
- `src/domain/settings/fonts.ts`：通用字体组合与字体族投影。
- `src/domain/settings/rules.ts`：设置校验，拥有主题/accent/自定义色/历史上限/editMode/原样保存/日志级别/日志目录的读取校验与归一化。
- `src/domain/settings/theme.ts`：主题令牌与色彩数学，拥有 accent 预设、light/dark 中性色、`createThemeColors` 纯函数及 `THEME_TOKEN_MAP` 的 ThemeColorTokens 与主题属性映射。
- `src/orchestrators/settings-persistence.orchestrator.ts`：设置持久化与镜像，负责保存、广播、接收镜像、编辑历史容量同步及已提交设置的装配回调。
- `src/services/app-settings.service.ts`：settings 读写签名与 command 参数装配。
- `src/stores/settings-store.spec.ts`：容量输入、初始化与镜像边界验证。
- `src/stores/settings.store.ts`：settings 运行态，只持状态、setter 与派生值；初始快照经统一初始化入口注入。

### 消费

- `src-tauri/src/models/app_settings.rs`：设置 wire 模型与四项容量的默认值。
- `src-tauri/src/models/cache_limits.rs`：设置持久化消费的缓存预算模型与默认值。
- `src/domain/cache-limits.ts`：缓存预算完整性与数值范围校验。
- `src/shared/runtime/cache-limits.ts`：正式预算快照、变更通知与缓存订阅释放。
- `src/shared/types/app-settings.types.ts`：完整设置快照、主题及保存请求。
- `src/shared/types/cache-limits.types.ts`：完整设置快照消费的缓存预算协议。
- `src/shared/ui/FieldHints.vue`：设置说明、注意与风险的共同展示。
- `src/shared/ui/FieldRow.vue`：设置字段、控件和说明的共同展示。
- `src/test/cache-setup.ts`：缓存服务测试消费的完整预算装配。
- `src/test/settings.ts`：完整设置快照及独立覆盖的共享测试夹具。

### 装配

- `src/app/WindowShell.vue`：唯一窗口壳，main 模式启动设置持久化、child 模式启动设置镜像并挂载主题 effect。

### 关联

- `src/app/components/SettingsPage.spec.ts`：四项设置的位置、范围、单位及更新行为验证。

## 边界

- Rust 设置服务拥有正式 revision 与 snapshot，主窗口拥有编辑值和唯一保存队列。
- `appearance` 提供沉浸式固定颜色；设计类型与槽位语义颜色归所属领域投影。
- settings 持久化目标是工具 app-data，私有根由 Tauri 标识 `com.caopancake.circinus-ad-astra` 解析。
- 唯一主题 effect 拥有 DOM 写入，窗口壳与 Naive provider 消费同一具体颜色。
- 日志目录动作经设置 ViewModel 与持久化编排接纳后端规范化快照。
- 设置和镜像提供请求 editMode，各编辑面拥有实际模式及所属输入交接。
- 设置服务必须在写盘后调用应用装配交付的运行参数动作；主窗口装配必须向保存队列交付正式提交后的历史摘要刷新动作。
- 领域拥有输入校验与主题算法，store 持有设置运行态、setter 和派生结果。
- 领域拥有通用字体组合，主题 effect 与 Naive provider 消费 store 派生的同一字体族。

## 链路

### 主窗口设置保存

1. 用户修改任一设置项，store 状态变化。
2. 持久化编排侦听快照变化，同步 CSV `editHistoryLimit` 并串行提交设置。
3. 设置服务写入 `settings.json`，再消费应用装配的历史容量与媒体预算动作。
4. Rust 提交运行参数、revision 与完整 snapshot，通知各窗口并返回同一快照；窗口接纳正式预算并立即清理超额缓存。
5. 保存队列必须调用装配传入的历史刷新动作，并按会话身份和 revision 接纳摘要。
6. 保存或刷新失败进入所属日志，当前内存设置保持其编辑值。

### 子窗口设置镜像

1. 全部窗口先注册通知，再从设置服务读取正式 snapshot 初始化 store。
2. 子窗口唯一窗口壳先注册设置镜像通知，再读取最新正式快照。
3. 快照按递增 revision 接纳，经校验规则整体替换 store 状态。
4. 同步 `editHistoryLimit` 到子窗口的 CSV 历史，快照历史消费各自响应式容量。
5. 各输入面按所属输入集合接纳 editMode；确认放弃后替换控件，取消保持当前模式。

### 日志目录保存

1. 设置页 ViewModel 调用持久化编排的日志目录保存。
2. 快照写入后端；后端校验目录并返回规范化完整快照。
3. 返回规范化快照按提交时捕获字段接纳，期间的新编辑继续进入保存队列。
4. Rust 设置服务通知全部窗口，通知失败登记诊断。

### 主题生效

1. 主题 effect 读取系统明暗偏好并监听变化，将系统主题写入 store 运行态。
2. store 按手动主题选择或系统主题派生显示主题，主题或 accent 变化触发主题令牌重算。
3. 主题 effect 把 root dataset 主题名与全部主题变量写入 document。
4. 唯一窗口壳的 Naive provider 消费同一份令牌派生的覆盖对象。

### 通用字体选择

1. 设置页 ViewModel 通过设置 service 请求本机已安装字体族。
2. 后端 Windows 枚举去重并排序，读取票据接纳所属设置页的字体选项。
3. 用户选择字体族或默认组合，store 发布完整设置快照并派生字体族。
4. 主题 effect 更新 `--font-sans`，Naive provider 消费相同字体族。
5. 默认文字测量消费响应式字体族并更新截断与布局。

## 规范

- `accent` 与 `editMode` 必须是正式枚举；正式快照初始化与替换必须校验有效值。
- `cacheLimits` 随完整快照持久化与镜像，正式快照接纳后立即应用；条数范围为整数 0–65536，MiB 范围为整数 0–4096，零值关闭相应闲置缓存。
- `cacheLimits.mediaData` 必须统一表达闲置媒体条数与 MiB，默认值必须为 2048 与 64；活跃租约必须独立计量。
- `editHistoryLimit` 与 `fileHistoryLimit` 必须分别控制每个编辑撤销栈及每个 Mod 根的文件保存历史，默认值必须分别为 250 与 20，整数范围必须为 1–1000；设置读取和保存必须共同校验范围。
- `expandFieldDescriptions` 是默认关闭的布尔值，必须随完整设置快照持久化及镜像，schema 字段展示即时消费该设置。
- `generalFont` 必须以 `null` 表达默认字体组合，以非空且不含控制字符的单个字体族名表达选择；默认组合必须为 Inter、Segoe UI、Microsoft YaHei 和 sans-serif，选择必须随完整快照持久化及镜像。
- `immersiveGameFont` 必须是默认开启的布尔值，并随完整设置快照持久化和镜像；字体设置框必须声明有意的缺字问号显示。
- `logBackupCount` 默认必须为 1，整数范围必须为 1–20；`logRotationSizeMiB` 默认必须为 5，整数范围必须为 1–1024。
- `logLevel` 只允许 debug、info、warning 和 error，默认必须为 info；正式保存后必须立即更新当前进程与各窗口的记录级别。
- `performanceMonitorEnabled` 必须是默认关闭的布尔值并随完整快照保存及镜像，正式快照必须另行交付重启前固定的 `performanceMonitorActive`。
- `preserveOriginalJson` 必须是布尔值；缺省视为 `true`。该设置必须随完整 snapshot 持久化并镜像到子窗口，结构化 JSON 保存动作必须在开始时捕获本次使用的值。
- `theme` 必须以 `null` 表示默认跟随系统，以 `light` 或 `dark` 表示手动选择；手动切换必须持久化明确选择，显示主题必须由选择与系统运行态派生，系统运行态严禁写入 settings snapshot。
- 主题计算必须由 domain 纯函数执行，DOM 写入只允许由唯一主题 effect 完成；Provider 必须消费具体颜色值。
- 保存失败必须保留编辑值并允许下一次 flush 重试；通知及历史摘要刷新失败必须登记诊断并保留正式提交结果。
- 同一输入面的子控件必须消费同一实际模式；不同输入集合必须分别拥有模式交接，模式确认必须绑定目标与生命周期。
- 子窗口只允许接收完整 settings 镜像，严禁发送设置广播。
- 字体设置框必须位于外观之后，通用字体下拉栏必须位于沉浸式编辑器字体开关之前；字体选项必须消费本机已安装的水平字体族与默认组合。
- 日志目录读取必须以 `logDirectory=null` 表达 app-data 默认目录，并拒绝空白字符串。
- 缓存预算必须在前后端保持同一字段与默认值；条数必须为 0–65536 的整数，MiB 必须为 0–4096 的整数。
- 自定义 accent 必须是 `#rrggbb` 形式；设置保存必须拒绝非法输入。
- 设置保存必须消费捕获的所属 store、快照和生命周期；释放后的成功与错误严禁接管新窗口投影或广播。
- 设置关闭交接必须先等待本轮变更进入保存队列，再完成最新完整快照的写盘；失败必须保留窗口与当前设置，后续关闭必须允许重试。
- 设置启动必须在文件读取失败、JSON 语法错误或根结构非法时采用完整默认设置，严禁因设置文件内容阻止窗口打开；读取严禁改写原文件。
- 设置启动必须在磁盘字段缺失、类型错误、枚举非法或范围越界时采用该字段正式默认值，必须保留其它有效字段；嵌套预算必须逐叶字段恢复。
- 设置字段必须消费共同字段行，所属说明必须通过字段说明插槽交付，控件必须连接原有设置动作。
- 设置恢复诊断必须由首次快照接纳后统一记录所属路径、字段及原因，日志读取严禁递归发布恢复诊断；不可用日志目录必须恢复为默认目录。
- 设置说明与注意分别交给公共 FieldHints，允许编辑原版的开关、说明与注意位于编辑分组。
- 设置页在缓存限制中展示历史步数、图片与媒体的条数及 MiB、八类查询条数、每张字体图集的字形条数；配置文件分组展示日志轮转大小与备份份数。
- 设置页释放必须撤销字体与日志展示读取的接纳；已执行日志动作必须由所属窗口反馈结果，页面投影必须由当前读取票据接纳。
- 路径授权必须消费后端根边界，`starsectorRoot` 只允许作为默认目录提示。
- 镜像监听与持久化监听释放后必须允许重新装配；迟到的监听注册必须立即解除，严禁接纳已释放窗口的设置。
- 首次加载及保存必须由 Rust 串行执行；保存必须依次确认权限、校验和规范化、写盘、更新运行参数、提交快照、通知并返回同一快照。

## 陷阱

- 保存失败后继续广播会让其它窗口采纳未落盘状态。
- 在 store 内直接写 document 会让主题副作用脱离唯一窗口壳的挂载时机。
- 用部分字段 patch 应用镜像 snapshot 会让未广播字段残留旧值。
- 绕过校验规则直接写 store 内部字段会让非法枚举进入持久化链路。
- 让 provider 消费 `var(...)` 会让 Naive 在运行时推导具体颜色并读取 DOM 计算值。
- 设置读取必须经 Rust 正式快照，重新获得焦点必须补读。
