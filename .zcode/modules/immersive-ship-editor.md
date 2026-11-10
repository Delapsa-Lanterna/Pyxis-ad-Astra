# 沉浸式舰船编辑器

## 定义

沉浸式舰船编辑器模块提供基础舰船与皮肤的有效船体投影、有序字段编辑及只读消费入口。

## 参考

### 拥有

- `src/app/components/immersive/ship/`：舰船内容与静态贴图展示组件。
- `src/domain/immersive/ship/`：舰船信息、来源、统计及行为测试。

### 消费

- `src/app/components/immersive/ImmersivePanelRow.vue`：共同字段行及标签排布。
- `src/app/components/immersive/ImmersivePanelSources.vue`：面板来源记录展示。
- `src/app/components/immersive/ImmersiveSection.vue`：共同内容分组及标题展示。
- `src/app/components/immersive/ImmersiveText.vue`：沉浸式文本片段与字体角色展示。
- `src/app/components/immersive/immersive-render-context.ts`：只读与编辑展示契约。
- `src/domain/fonts/font.types.ts`：字体身份、文本片段、位图对象与排布结果的纯类型。
- `src/domain/immersive/design-type.ts`：设计类型名称及颜色规则。
- `src/domain/immersive/fields.ts`：字段规则、数值投影与具名关联查询输入契约。
- `src/domain/immersive/hull-fields.ts`：船体基础与皮肤字段的统一读取、计算与输入投影。
- `src/domain/immersive/source-records.ts`：可编辑来源与装配记录选择。
- `src/domain/joint-edit.ts`：联合写入范围提取、身份映射、草稿重接与冲突选择投影。
- `src/domain/schema/`：字段与列资产加载、游戏数字解释、来源声明、校验及目标格式准备。

## 边界

- 内容组件消费只读或编辑展示协议。
- 基础运行态拥有会话、历史、保存和关联读取。
- 字符、数值与来源字段由舰船投影提供。
- 舰船模块拥有内容布局与基础计算，字体和媒体消费正式能力。
- 装配交付独立只读输入并消费所属舰船信息。

## 链路

### 舰船信息

1. 宿主按舰船定义建立联合基线和所属来源。
2. 舰船投影消费当前记录、字段绑定和关联内容。
3. 内容组件按展示协议呈现字段与贴图。
4. 编辑动作由基础会话提交所属来源并保存。

### 装配只读信息

1. 装配捕获当前主舰或模块的有效船体与统计。
2. 舰船投影接纳独立只读输入，生成同一内容模型。
3. 只读容器呈现所属技术信息并释放悬浮媒体。

## 规范

- 只读与编辑内容复用同一舰船内容投影。
- 皮肤窗口必须沿用真实皮肤身份和舰船展示能力，属性浮层分别交付基础与各层受支持的皮肤字段；未填写覆盖保留继承输入入口。
- 舰船名称、定位、设计类型、系统与性能消费基础 CSV 及按序皮肤覆盖，几何、槽位、内置引用与贴图消费有效规格，描述消费实际来源的 `SHIP` 记录与皮肤前缀。
- 舰船船员绑定 `min crew` 与 `max crew`，部署点数消费 `supplies/rec`；护盾维持按 `shield upkeep` × `flux dissipation` 计算，相位消耗按来源系数 × `max flux` 计算。
- 装配统计只允许作为只读投影，基础船体修改必须提交实际来源参数。
