# 新建 Mod

## 定义

新建 Mod 模块创建最小 Mod 骨架并交接创建结果的打开。

## 参考

`src-tauri/src/commands/mod_creation.rs`：创建 command 边界。
`src-tauri/src/domain/mod_creation.rs`：Mod ID 与路径规则 owner。
`src-tauri/src/io/mod_creation.rs`：目录骨架与模板写入 owner。
`src-tauri/src/services/mod_creation.rs`：创建 service 实现 owner，拥有目标校验、冲突检查与回滚。
`src/app/composables/config/use-create-mod-view-model.ts`：创建对话框 ViewModel owner，拥有游戏根/父目录分流、表单校验与保存中状态。
`src/domain/mod-creation/new-mod-template.ts`：模板与校验 owner，拥有 ID/名称/版本规则与 mod-info 默认值。
`src/orchestrators/directory-opening.orchestrator.ts`：创建结果打开 owner，复用 Mod 打开链路。
`src/orchestrators/mod-creation.orchestrator.ts`：创建编排 owner，负责创建调用、性能打点与打开结果分流。
`src/services/mod-creation.service.ts`：类型化创建签名与 command 参数装配主归属。
`src/shared/types/mod-creation.types.ts`：类型化创建请求与返回模型。

## 边界

- IO 以模板创建最小目录骨架与 `mod_info.json`，失败恢复范围为本次创建的根。
- domain 拥有 ID、文本规则及 schema 默认模板。
- workspace、session 与打开状态由正式目录打开及工作区生命周期建立。
- 创建 ViewModel 拥有目标分流、表单校验和提交状态，编排交接创建结果与打开动作。
- 创建成功后的打开结果由编排反馈，磁盘创建结果保持独立。
- 后端拥有安全父目录、目标占用与同目录 Mod ID 校验。

## 链路

### 校验与提交

1. 用户在对话框输入 Mod ID、名称、版本与游戏版本。
2. ViewModel 按受限 ASCII 规则校验 ID，按长度上限校验文本字段。
3. 存在游戏概览时目标为游戏根下 `mods`；否则请求用户选择 Mod 父目录。
4. 用户提交后 ViewModel 调用创建编排。

### 后端创建

1. 后端校验游戏目标为有效游戏目录，或父目录为安全已存在目录。
2. 后端检查目标目录不存在，且同父目录已解析 Mod ID 无冲突。
3. 以 Mod ID 创建目录并生成最小目录骨架。
4. 以 UTF-8 无 BOM 与 CRLF 写入 `mod_info.json` 模板。
5. 成功返回 canonical `modRoot` 与已解析的可选游戏根；失败回滚本次创建的根目录。

### 打开创建结果

1. 编排层记录创建与打开两个阶段的性能打点。
2. 复用目录打开链路刷新概览并建立 ProjectSession。
3. 打开结果为新加载时返回 Mod 名称与警告；取消时结束打开动作；已存在时抛出带动作的错误。
4. 打开失败时保留创建结果但向用户呈现明确错误。

## 规范

- Mod ID 必须匹配受限 ASCII 标识规则，同时作为新建目录名。
- `mod_info.json` 模板必须输出 UTF-8 无 BOM 与 CRLF。
- 创建只允许写入 `mod_info.json` 与空目录骨架，目录必须包含 hulls、weapons、variants、factions、missions 和图像资源目录。
- 创建完成后的打开取消只允许结束打开动作；创建结果必须保留在目标目录。
- 创建请求期间必须禁用提交并呈现保存中状态。
- 名称、版本与游戏版本必须是非空单行文本且不超过各自长度上限。
- 模板默认值必须来自 mod-info schema 的字段默认值，缺失时抛出错误。

## 陷阱

- 允许非 ASCII 或路径分隔符的 Mod ID 会把目录穿越引入创建链路。
- 创建失败后残留部分目录会让下一次创建因目录冲突失败。
- 在前端拼接游戏 `mods` 路径会绕过后端对游戏根的 canonical 校验。
- 打开结果按普通加载处理会把"已存在"与"无法打开"吞成成功状态。
- 预置业务实体文件会改变游戏的合并与覆盖语义。
