# JSON 来源组合与覆盖

## 定义

JSON 来源组合与覆盖模块维护 Starsector 有序 JSON 来源的有效内容、稀疏本地修改及整体覆盖规则。

## 参考

### 拥有

- `src-tauri/src/domain/json_composition.rs`：游戏 JSON 合并、排除字段及整体覆盖组合。
- `src/domain/json-composition.ts`：前端内容组合、来源定位、稀疏编辑及覆盖撤销。

### 消费

- `src/shared/lib/json-edits.ts`：JSON 对象赋值、移除和整体数组差异。
- `src/shared/lib/row-data.ts`：对象内容判定。
- `src/shared/lib/stable-compare.ts`：JSON 内容相等判断。
- `src/shared/lib/starsector/value.ts`：独立 JSON 内容复制。
- `src/shared/types/json-composition.types.ts`：有序来源、版本及 replace 协议。

### 关联

- `src-tauri/src/services/project/query/json_layers.rs`：正式有序来源及版本读取。
- `src/test/fixtures/json-composition.json`：前后端共同的游戏合并样本。

## 边界

- 项目来源读取维护授权、有序层和版本，组合能力消费捕获的内容。
- 组合规则交付有效 JSON 值及字段来源，调用方持有所属文档和会话。
- 本地覆盖编辑交付稀疏内容、提示及拒绝结果，草稿历史维护状态寿命。
- 保存准备消费覆盖意图及实际本地内容，写盘和事务由所属业务维护。
- 实体查询、资源、身份确认和各编辑面共同消费同一格式语义。

## 链路

### 组合与编辑

1. 消费者交付有序来源、本地内容、replace 及排除字段。
2. 组合规则按数组和对象语义计算有效内容及字段来源。
3. 组合编辑比较实际变化，交付稀疏更新或携带原本地内容的整体替代结果。
4. 保存准备提取并移除替代标记，向所属写入动作交付 replace 意图。

## 规范

- JSON 组合必须只消费公共模型和纯运算，严禁持有会话注册、窗口、文件读取或保存协调状态。
- 前后端游戏合并必须共同消费同一组共享样本，数组追加、首项清空标记、颜色与音乐数组、对象类型及排除规则保持对应。
- 来源顺序、实际来源版本与 replace 必须由调用方捕获后交付，内容组合保持输入归属。
- 组合编辑必须只提交实际本地修改；继承数组只允许在继承项之后追加，修改或删除继承项将所属文件对象转为整体取代并提示，取代标记随草稿历史撤销，`settings.json` 拒绝该修改；工具严禁生成 `core_clearArray`。
- 显式空字符串、数值零与 false 必须保留本地覆盖，来源定位按实际组合结果计算。
- 整体替代必须保留原稀疏内容供所属草稿历史撤销，保存前移除本地替代标记并交付实际 replace 意图。
