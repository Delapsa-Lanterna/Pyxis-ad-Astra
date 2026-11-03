# 字段定义与校验

## 定义

字段定义与校验模块维护字段、来源、CSV 列及其声明顺序，并交付资产解析和纯值规则。

## 参考

### 拥有

- `schemas/csv/`：CSV 列 schema 资产。
- `schemas/engine-styles.schema.json`：引擎样式的固定属性与新建初值。
- `schemas/faction.schema.json`：势力字段模式资产。
- `schemas/game-settings.schema.json`：设计类型颜色与按分组编辑的游戏设置。
- `schemas/hull-styles.schema.json`：船体样式的固定属性与新建初值。
- `schemas/mission.schema.json`：任务字段模式资产。
- `schemas/mod-info.schema.json`：Mod 信息字段模式资产。
- `schemas/skin.schema.json`：皮肤字段模式资产。
- `schemas/sounds.schema.json`：音效数组、声音组对象及音乐目录字段。
- `schemas/spec-projectile.schema.json`：弹体、导弹及内部对象的字段与分支声明。
- `schemas/spec-ship.schema.json`：舰船、槽位及引擎的字段与内部对象声明。
- `schemas/spec-system.schema.json`：战术系统字段、默认值及条件分组声明。
- `schemas/spec-weapon.schema.json`：武器字段及前后端共同消费的保存约束。
- `schemas/strings.schema.json`：分组字符串与根级文本的文件表单。
- `schemas/variant.schema.json`：装配字段模式资产。
- `src-tauri/src/domain/csv_column_order.rs`：从唯一 CSV schema 提取标准列并维护补列顺序。
- `src-tauri/src/domain/schema.rs`：字段完整性、分支、类型和条件校验。
- `src-tauri/src/domain/schema_sources.rs`：配置字段来源、相对路径及对象分组声明。
- `src/domain/schema/`：字段与列资产加载、来源声明、值及结构纯规则。

### 消费

- `src-tauri/build.rs`：字段资产的编译期索引。
- `src-tauri/src/parsers/field_schema.rs`：内嵌字段资产的严格读取。
- `src/shared/lib/input-number.ts`：完整浮点及安全整数解析。
- `src/shared/lib/paths.ts`：路径标签纯投影。
- `src/shared/lib/starsector/value.ts`：JSON 值复制。
- `src/shared/types/core-assets.types.ts`：发现字段协议。
- `src/shared/types/json.types.ts`：JSON 数据形状。
- `src/shared/types/tables.types.ts`：正式表键。

## 边界

- 资产与加载器维护字段、来源、版本及形状，CSV 列顺序来自所属资产。
- 来源声明提供可解释的名称和配置路径，实际候选由来源目录查询。
- 值规则按字段定义解释类型、条件、初值、结构更新和路径。
- Core 字段合并消费已经取得的发现记录，交付补全后的定义。
- 项目会话、实体构造、保存校验和字段编辑消费同一套定义。

## 链路

### 定义加载

1. 配置和 CSV 注册表读取所属资产，解析版本、字段形状及来源名称。
2. 已注册定义按 ID 或正式表键交付同一对象，Core 发现字段按声明合并。
3. 消费者按定义解释值、来源、约束和字段结构。

### 标准列与校验

1. 正式表头回退和表格排序读取所属 schema 的 columns 顺序。
2. 字段值与来源声明交给所属纯规则，Rust 保存校验读取对应字段资产。

## 规范

- CSV 标准列及顺序必须唯一来自各表 schema 的 columns 声明，严禁新增独立列序资产或第二份手工列清单；正式表头回退和展示排序必须消费该声明。
- Bundled JSON schema 必须以 `schemas/*.schema.json` 文件登记，文件名必须与资产 ID 一致；前端注册与 Rust 编译期索引必须消费同一目录。
- Bundled schema 注册时必须校验每个 `csv:` source 的表名属于正式 CSV 表注册表或实体注册表的 source 声明，无效 source 必须阻止注册。
- `root` 必须定义独立文件内容，`nested`、`valueSchema` 与 `item` 必须分别定义固定属性、可命名条目与列表元素，`operations` 必须限定结构动作。
- schema 资产必须按配置、CSV 列与 Mod 信息入口加载，资产解析必须复用所属版本、形状与来源校验。
- `variants` 分支必须继承所属字段的键与名称，版本对象的数字与字符串部分必须保留原类型。
- 字段默认与数组项默认必须由所属 schema 消费语义决定；完整规格新建必须消费所属格式的共享模板构造。
- 对象键、条目数量、互斥字段及条件必填必须分别消费 `keySchema`、`minEntries`、`maxEntries`、`exclusiveKeys` 与 `requiredWhen`，条件必须按字符串相等、数字下限或键缺失共同交付字段标签和检查，结构操作必须服从所属约束。
- 嵌套字段与键值输出必须保留自有业务键；字段路径读取只允许消费自有属性，构造可写字典必须采用无原型对象。
- 字段定义及来源声明必须只消费本模块纯规则和公共契约，严禁依赖字段编辑运行态、业务查询或保存协调。
- 配置字段来源必须消费前后端对应的 CONFIG_FIELD_SOURCES，来源名称、相对路径和对象分组必须保持一致。
- Spec 字段、分组、取值与保存约束必须声明在 schemas 资产；定义、嵌套与分支的来源必须共同校验，展示条件必须支持当前文档路径、正数判断与任一分支。
- 静态字段定义合并必须消费当前 Core 根的发现结果，发现失败时必须保留静态 schema。
