# 新建 Mod

## 定义

新建 Mod 模块创建最小 Mod 骨架并交付实际创建结果。

## 参考

### 拥有

- `src-tauri/src/commands/mod_creation.rs`：创建 command 边界。
- `src-tauri/src/domain/mod_creation.rs`：Mod ID 与路径规则。
- `src-tauri/src/io/mod_creation.rs`：目录骨架与模板写入。
- `src-tauri/src/services/mod_creation.rs`：创建 service 实现，拥有目标校验、冲突检查与回滚。
- `src/domain/mod-creation/`：新建 Mod 模板与请求投影。
- `src/domain/mod-creation/new-mod-template.ts`：模板与校验，拥有 ID/名称/版本规则与 mod-info 默认值。
- `src/orchestrators/mod-creation.orchestrator.ts`：创建编排，负责实际创建调用、创建日志及结果交付。
- `src/services/mod-creation.service.ts`：类型化创建签名与 command 参数装配。

### 消费

- `src-tauri/src/models/mod_creation.rs`：新建目的地、模板与正式创建结果。
- `src-tauri/src/services/project/sources/roots.rs`：新建目标消费的游戏 mods 目录授权与游戏根推断。
- `src/domain/schema/mod-info-schema.ts`：新建模板消费的已校验 Mod 信息字段默认值。
- `src/shared/types/mod-creation.types.ts`：类型化创建请求与返回模型。

## 边界

- IO 以模板创建最小目录骨架与 `mod_info.json`，失败恢复范围为本次创建的根。
- domain 拥有 ID、文本规则及 schema 默认模板。
- 工作区拥有 session 打开与释放，创建能力交付实际目录结果。
- 创建服务消费明确目的地与模板，交付实际创建结果；工作区拥有目的地选择与创建后的打开。
- 磁盘创建结果由实际写入决定，工作区分别接纳创建和打开结果。
- 后端拥有安全父目录、目标占用与同目录 Mod ID 校验。

## 链路

### 创建输入

1. 工作区交付明确的游戏根或 Mod 父目录，以及已校验模板。
2. 创建编排调用正式创建 service 并交付实际结果。

### 后端创建

1. 后端校验游戏目标为有效游戏目录，或父目录为安全已存在目录。
2. 后端检查目标目录不存在，且同父目录已解析 Mod ID 无冲突。
3. 以 Mod ID 创建目录并生成最小目录骨架。
4. 以 UTF-8 无 BOM 与 CRLF 写入 `mod_info.json` 模板。
5. 成功返回 canonical `modRoot` 与已解析的可选游戏根；失败回滚本次创建的根目录。

## 规范

- Mod ID 必须匹配受限 ASCII 标识规则，同时作为新建目录名。
- `mod_info.json` 模板必须输出 UTF-8 无 BOM 与 CRLF。
- 创建只允许写入 `mod_info.json` 与空目录骨架，目录必须包含 hulls、weapons、variants、factions、missions 和图像资源目录。
- 创建失败必须回滚本次创建的根目录。
- 名称、版本与游戏版本必须是非空单行文本且不超过各自长度上限。
- 模板默认值必须来自 mod-info schema 的字段默认值，缺失时抛出错误。
- 游戏 `mods` 目标必须由后端按已授权游戏根解析。
