# 后端文件读写与变更集

## 定义

后端文件读写与变更集模块提供授权磁盘操作及可回放的文件和目录变更。

## 参考

### 拥有

- `src-tauri/src/io/csv_files.rs`：CSV 文件读写与路径上下文。
- `src-tauri/src/io/faction_index.rs`：索引引用的实际根与父链授权。
- `src-tauri/src/io/file_changes.rs`：changeset 构建、应用与回放。
- `src-tauri/src/io/file_versions.rs`：规范路径版本采集与指纹核对。
- `src-tauri/src/io/json_files.rs`：JSON 文件读取及匹配版本交付。
- `src-tauri/src/io/mod.rs`：底层文件、路径及 changeset 能力导出。
- `src-tauri/src/io/paths.rs`：磁盘路径展开、父链授权与改名目标解析。
- `src-tauri/src/io/text.rs`：同次字节读取、严格纯文本解码与 UTF-8 写出。

### 消费

- `src-tauri/src/models/file_changes.rs`：文件变更、目录内容快照及统一回放方向。
- `src-tauri/src/models/file_content.rs`：精确文档、原始格式、物理 CSV 行格及完整写入请求。
- `src-tauri/src/parsers/game/`：游戏 JSON/CSV 的正式读取入口、文档方法、数值及文本格式能力。
- `src/shared/types/file-changes.types.ts`：文件变更、目录快照与回放方向的基础契约。

### 关联

- `src-tauri/src/services/write_transactions.rs`：根写入租约、版本复核、历史登记、回放及会话内容接纳。
- `src/shared/lib/paths.ts`：文件系统、资源及游戏目录的路径纯规则。

## 边界

- `FileChangeRecord` 表达路径、存在状态与内容快照，目录事件展开实际文件影响。
- FsRootBoundary 提供 canonical 根、实际目标与已有父链授权，目录条目的链接及 reparse 判定消费所属遍历元数据。
- IO 拥有磁盘路径、遍历、读取、写入、删除和 changeset 应用。
- parser 和 renderer 拥有格式语义，IO 按调用方文本写入 UTF-8 字节。
- 回放消费既有快照并核对当前磁盘授权，错误保留目标与上下文。
- 根事务提供版本、FIFO 租约与失败恢复，IO 返回实际应用结果。

## 链路

### 文本读取

1. 保存链路或编辑器请求读取目标文件。
2. IO 读取字节并共同生成文件版本。
3. 格式入口按结构化或纯文本合同解码完整输入。
4. 返回文本与路径上下文。

### 保存与 changeset 构建

1. 保存入口提交目标路径与文本。
2. IO 校验 canonical root、父链链接与路径边界。
3. 写入前快照当前内容，写入 UTF-8 无 BOM 字节。
4. 构造 before/after `FileChangeRecord` 并展开目录事件。
5. 返回 changeset 与失效路径给 ProjectSession。

### 回放

1. 文件历史回放以确认后的 changeset 请求回放。
2. IO 重校验全部路径归属与父链。
3. 按 before/after 快照逆向或正向应用变更。
4. 根保存租约在写入失败后恢复本次修改，恢复受阻等待所属请求处理。

## 规范

- `FileChangeRecord` 必须共同承载 `beforePath`、`afterPath` 与前后内容；普通写入使用相同路径，文件或目录改名使用源与目标路径。
- 根写入租约必须统一转换回放方向；撤销反转路径、内容与执行顺序，文件及目录原语消费转换后的目标内容。
- Windows 仅大小写改名必须按同一物理文件检查占用，并且由正式文件改名原语交接实际名称。
- `write_utf8_no_bom` 必须按调用方提供的文本原样写入 UTF-8 字节；换行、缩进与序列化规则归各格式 renderer。
- 写入必须携带读取版本凭据并在出队执行时比较；冲突返回 `write.version_conflict` 和目标路径，严禁写入或推进历史。
- 变更快照必须记录目标实际存在状态与内容，撤销消费实际 before 快照。
- 同一 canonical 根的写入必须按 FIFO 执行，嵌套同步写服务共享事务租约；不同根独立执行，锁序为根租约、session 状态、缓存。
- 纯文本读取必须严格解码 UTF-8 或明确源编码，结构化文本交给所属格式解码，写出统一采用 UTF-8。
- 构造、应用、失败恢复、版本校验与回放必须共同消费双路径；撤销同时反转路径、存在状态与内容快照。
- 根保存租约必须持有实际写入前内容和存在状态，写入失败逆序恢复已执行及部分执行步骤，恢复重试继续未恢复位置。
- 文本与二进制恢复必须保留原始字节，文件已恢复到原内容时释放该恢复位置。
- 写入与恢复必须重新核对所属根和实际父链，根缺失等待恢复原位置。
- 源内容与文件版本必须从同一次读取字节生成，文本解码继续消费正式编码入口。
- 源记录与目标凭据必须在同一 FIFO 租约中复核；缺少所属目标的读取凭据以 write.version_scope_missing 拒绝写入。
- 目录版本必须汇总排序后的子文件相对路径与内容版本，磁盘核对及 changeset 接纳消费同一算法。
- 路径展开与身份规范化必须归 IO；现存目标交付规范长路径，缺失目标展开现存父目录并保留剩余段，改名目标保留要求的末级名称；消费者只允许接纳 IO 输出。
- 文件系统身份比较与缓存键必须在磁盘路径展开后消费 `windows_path_key`；磁盘展开只允许由 `io/paths.rs` 实现，公共测试计数器遵守同一边界。
- Windows 大小写规则必须按 UTF-16 单元采用系统映射并保留路径长度；文件名中的不同字符序列按 Windows 序号比较区分，规则按普通目录的大小写行为验证。
- 路径授权必须核对目标及已有父链的链接边界，历史回放重新完成授权。
