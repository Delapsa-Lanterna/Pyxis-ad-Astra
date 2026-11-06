# 文本与格式解析器

## 定义

文本与格式解析器模块提供 Starsector CSV-like 与 JSON-like 的解析和渲染。

## 参考

### 拥有

- `src-tauri/src/parsers/`：游戏文本及工具 JSON 的解析、渲染与格式诊断。
- `src-tauri/src/parsers/alex_csv.rs`：CSV-like 解析与渲染，字符级行状态机对齐游戏 CSVParser (列数容忍、空行/`#` 行保留)，并按最小引号规则渲染。
- `src-tauri/src/parsers/alex_json.rs`：JSON-like 字符级 tokener，消费游戏 org.json 与 LoadingUtils 格式语义。
- `src-tauri/src/parsers/faction_index.rs`：索引列、行位置、ID 列与引用列的格式解析。
- `src-tauri/src/parsers/preserve_json.rs`：结构化 JSON 原文更新，定位字段文本范围并核验写回语义。
- `src-tauri/src/parsers/tool_json.rs`：工具私有 JSON 数据的 serde 读取入口。
- `src-tauri/testdata/`：游戏 CSV 与 JSON-like 解析夹具。

### 消费

- `src-tauri/src/io/csv_files.rs`：CSV 文件读写与路径上下文。
- `src-tauri/src/io/json_files.rs`：JSON 文件读取与目录遍历。
- `src-tauri/src/io/text.rs`：文本读取，拥有 UTF-8 BOM 剥离与已知 CP1252 字节归一化入口。
- `src-tauri/src/models/text.rs`：Starsector 文本解码与 CP1252 标点规则。

### 关联

- `src-tauri/src/services/config_entity.rs`：Mod 信息与战役目录保存的格式消费者。
- `src-tauri/src/services/json_file.rs`：装配与皮肤文件保存的格式消费者。
- `src-tauri/src/services/spec_editor.rs`：外部规格导入的格式消费者。

## 边界

- CP1252 归一化映射归 models，CSV 字节解析与文本读取共享解码入口。
- CSV-like 与 JSON-like 各自拥有游戏格式解析和渲染，工具私有 JSON 归 serde 入口。
- IO 拥有读取、缺失文件、路径和授权；service 拥有业务身份、changeset 与保存语义。
- preserve_json 拥有字段范围定位与语义核验，保存入口拥有整体序列化确认。
- 格式解析器接收字节或文本与路径上下文，输出业务结构和格式诊断。
- 错误位置由 parser 提供，实际路径由 IO 绑定，上层保留来源诊断。

## 链路

### CSV-like 解析

1. IO 读取字节并剥离 BOM，交付路径上下文。
2. CSV 入口调用共享解码，归一换行并分割表头，行状态机逐字符组装单元格和注释身份。
3. 文末冲刷末行，格式错误按实际物理位置返回。
4. 表头及 `CsvRow` 的 data、`isComment` 交给正式缓存和业务消费者。

### CSV-like 渲染

1. 保存链路捕获 data、`isComment` 和原表头。
2. renderer 按表头和行序生成单元格，按注释身份与引号规则输出记录。
3. 输出文本交给写入链路构成 changeset。

### JSON-like 解析

1. IO 提供文本与路径上下文。
2. LoadingUtils 注释处理生成过滤文本与原文位置映射。
3. 字符级 tokener 解析根对象，按值类型构造结构化数据。
4. 解析结果返回调用方，错误绑定原文位置与来源诊断。

### 结构化 JSON 原样保存

1. 保存入口捕获 `preserveOriginalJson`，读取现有目标或改名前源文件的原文与结构化数据。
2. 开启时定位原文中的对象成员、数组条目与值，只更新变化的范围；对象新增键按提交顺序追加，数组保留项按内容复用原文，数组新增项按提交顺序插入。
3. 更新结果经 JSON-like 解析器核验等于提交数据；无法安全定位或核验失败时返回受影响文件与源内容指纹，确认后复核源文件并整体序列化。
4. 关闭时直接按原保存入口的规范化规则序列化，写入经既有 changeset 链路完成。

## 规范

- CSV 与文本读取必须复用同一线性解码入口，合法 UTF-8 标量优先完整保留，独立 CP1252 修复字节按统一映射归一化。
- CSV 引号错误必须消费实际物理行；UTF-8 解码错误保留实际路径与原始字节诊断。
- CSV 换行解析必须将 CRLF 归一为 LF，并保留孤立 CR；无换行文件作为表头交付，EOF 冲刷末行并保持真实空行数量。
- CSV 注释身份必须由记录起点的原始首字符产生，严禁从解析后的业务值、列排序或 trim 结果推断；引号内换行属于当前记录。
- CSV 渲染必须保持原表头顺序与原文件的行序语义。
- CSV 渲染必须区分空 Map 裸行与全空单元格行，缺失键输出空单元格，记录以 LF 结尾。
- CSV 渲染必须消费正式 `isComment` 标记，并保留非注释首格的必要外围引号与注释记录的原始 `#` 前缀。
- CSV 行解析必须以双引号切换状态，以成对双引号产出字面引号；引号内逗号和换行保留，非引号 LF 终止记录。
- CSV 表头必须消费首行的朴素逗号分割，按 Java split 语义移除尾部空段，再逐格 trim、剥除首尾引号及合并双引号。
- CSV 解析对齐游戏 CSVParser：列数容忍 (短行缺失键不写入、长行丢弃多余)，严禁以列数不一致拒绝记录。
- CSV 解析必须保留可见空行 (空 Map 行)、全逗号行、`#` 行和引号内换行；引号内 `\r\n` 按 `\n` 保留。
- JSON 字符串必须合并合法 UTF-16 代理对；无引号 word 按游戏分隔集合终止。
- JSON 字面值必须对 `true`、`false`、`null` 忽略大小写，数值按 Long／Double 规则解析并在解析失败时返回字符串；非有限数值、字符串字面换行和未知转义返回格式错误。
- JSON 对象和数组必须消费游戏的无引号键值、分号、尾分隔符、等号及括号规则；数组空槽产出 `null`，根对象尾文按游戏规则忽略。
- JSON 根必须是对象，重复键报 json.duplicate_key，严禁静默 last-wins。
- JSON 注释处理必须保留原文位置映射；行列按实际编辑文本表达，列使用 UTF-16 单元。
- JSON 注释处理必须消费 LoadingUtils 的引号翻转和 CR／LF 规则，保留不感知转义的游戏行为及原文位置映射。
- JSON-like 解析必须对齐游戏 org.json 与 LoadingUtils 的字面行为及已裁定边界；格式分歧经用户裁决，严禁扩展为通用 JSON 修复器。
- 文本身份替换必须在完成 JSON-like 解析后定位根成员的值范围；嵌套字段、数组对象、注释与其它原文完整保留。
- 结构化 JSON 原样保存必须保持语义不变的现有文件字节；删除字段时保留独占行注释，并移除字段行尾注释。
- 结构化 JSON 数组增删与重排必须只调整所属条目及必要分隔符；未变条目保留原文，条目行尾注释随条目移动或删除，独立行注释留在原位置。
- 读取必须剥离 UTF-8 BOM 并消费统一 CP1252 归一化；保存写回归一后的文本。
- 除 UTF-8 BOM 剥离与已知 CP1252 智能引号修复外，读取口径保持严格 UTF-8 校验；严禁引入编码自动探测或全量 CP1252/GBK 读取解码，非 UTF-8 文件经用户显式选择源编码的转码动作修复。
- 需要整体重排的结构化 JSON 写入必须在 changeset 应用前取得确认；确认后按源内容指纹复核。
