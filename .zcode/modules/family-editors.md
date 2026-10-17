# 配置实体族编辑器

## 定义

配置实体族编辑器模块提供装配与皮肤的参数化列表、表单和保存交接。

## 参考

### 拥有

- `src-tauri/src/commands/config_family.rs`：装配与皮肤保存、创建、删除及会话来源核对。
- `src-tauri/src/services/config_family.rs`：后端族实体，按实体类型参数化保存、创建、删除与重命名。
- `src/app/components/config/ConfigEntityFamilyEditor.vue`：族编辑组件。
- `src/app/components/config/ConfigEntityFamilyList.vue`：族列表组件。
- `src/app/components/config/ConfigEntityFamilyView.vue`：族视图组合。
- `src/app/composables/config/use-config-family-editor-view-model.ts`：族编辑 ViewModel，拥有目标 Draft Session 接线与保存。
- `src/app/composables/config/use-config-family-view-model.ts`：族列表 ViewModel，拥有加载、新建、删除校验与资源引用。
- `src/domain/config/config-entity-families.ts`：族定义，消费实体 ID 字段并拥有伴随字段、文案、图标路径与媒体面。
- `src/services/config-family.service.ts`：两族查询、保存、创建及删除的正式能力包装。

### 消费

- `src-tauri/src/models/config_family.rs`：两族写入、删除请求与原始文件结构。
- `src/app/composables/config/use-config-identity-reception.ts`：两族消费配置身份事件的等待、确认与列表接纳。
- `src/domain/config/config-records.ts`：两族消费统一 `ConfigFamilyRecord` 与 `ConfigFamilyFile` 的查询、保存投影。
- `src/domain/project/entity-definitions.ts`：实体内容 ID 字段及字符串 ID 提取。
- `src/orchestrators/config-save.orchestrator.ts`：族保存动作归属的保存编排。
- `src/shared/types/config-family.types.ts`：两族请求、原始文件结构与所属编辑文件投影。
- `src/stores/workspace.store.ts`：当前 Mod 选择、清单与 session 的派生投影。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。

### 关联

- `src-tauri/src/services/project/write/entity_identity.rs`：规格、装配与文本身份写入及关联 CSV、父引用暂存。

## 边界

- family 定义消费统一实体 ID 字段，表达伴随字段、名称、排序和可选动作。
- 保存编排装配各族能力，写入范围由当前目标及身份规则声明的父引用确定。
- 参数化组件呈现列表与表单，列表和编辑 ViewModel 分别拥有选择、资源与目标会话。
- 后端拥有加载身份、目标路径、扩展名、创建删除和改名规则。
- 新建校验归族 ViewModel，名称 hydration 消费后端舰体引用元数据。
- 族表单提供联合交接参与者，沉浸式动作消费现有保存和窗口能力。
- 身份接纳消费配置交接入口，外部版本由所属会话直接接纳或暂存。

## 链路

### 族列表加载

1. 页面以族定义加载实体列表。
2. 后端返回实体数据与资源引用。
3. 列表按可视区渐进解析缩略图。
4. 装配列表额外解析舰船名称并按两行展示。

### 新建实体

1. 用户在新建对话框输入伴随字段与 ID。
2. 族 ViewModel 校验必填、ID 合法性与冲突。
3. 创建动作经保存编排写入所属实体文件，事务发布会话投影并登记历史。
4. 列表刷新并选中新实体。

### 编辑与保存

1. 选中实体加载目标草稿与表单。
2. 编辑经显式提交模型更新草稿。
3. 保存动作族返回 `SavedConfig`，承载正式实体与写盘 receipt。
4. 编辑会话接纳目标、内容与版本，列表接纳同一正式记录，再执行 receipt 同步。
5. dirty 时外部更新只暂存并提示。

### 删除实体

1. 用户发起删除并经确认。
2. 删除动作族移除所属实体文件，事务发布会话投影并登记历史。
3. 列表刷新并清理选择。

## 规范

- ID、companion、标题与排序必须消费同一正式记录；字段、标题组合与 Hull 名称 hydration 差异必须归 family 定义。
- JSON、类型文本与颜色的原始输入必须登记到所属目标会话；外部版本载入必须确认放弃草稿与输入。
- Skin 构造必须消费正式默认内容；`descriptionId` 与 `descriptionPrefix` 必须由明确字段动作建立，默认描述身份必须消费 `skinHullId`。
- 两族记录必须共同表达加载 id、target、data、`baseVersions`、path 与 relPath；列表与选择必须消费加载 id，字段编辑必须消费 data 中的下一 ID。
- 保存 receipt 必须与正式实体共同交给编辑会话；同步失败必须保留写盘基线，卸载后的提交只允许完成捕获目标的同步。
- 保存动作返回正式记录时必须保持当前列表与选择，编辑会话接纳之后必须共同更新列表和选择；同一会话的活动控件必须保持挂载。
- 保存期间列表刷新必须服从目标交接；重命名后只允许更新正式目标和已写盘基线，必须保留后续草稿与字段交互状态。
- 可选沉浸式入口必须由族定义声明，装配打开必须经过所属 ViewModel 与保存交接。
- 同 ID 保存必须保留源文件名与目录；ID 重命名必须在源目录生成新 ID 文件名，创建必须以显式 `null` relPath 使用默认路径。
- 外部改名期间必须保留当前编辑目标；确认跟随后必须共同接纳新目标、内容与版本，dirty 草稿与活动输入必须保留。
- 当前展示目标必须消费工作区的当前项目投影，异步动作必须捕获并持续消费所属 Mod 根与 session。
- 新 session 的族列表必须按所属 companion 与 ID 排序选择首项；列表内容、实际路径或基线版本凭据变化时必须通知编辑器接入，严禁只比较实体内容。
- 新建动作才允许加载舰体引用目录；目录项严禁预取缩略图。
- 无法解析舰船名称时必须显示 `hullId`，严禁改变装配引用或持久化数据。
- 界面刷新必须由所属根登记实际来源与动作，并沿现有保存等待、草稿和外部更新接纳流程执行。
- 皮肤列表必须从实体列表保留缩略资源引用并按可视区渐进解析。
- 皮肤编辑器的内置武器移除选项必须由当前草稿 `baseHullId` 的后端舰体引用结果提供，选项值必须是槽 ID。
- 编辑保存必须提交选中实体 query 返回的 relPath；command 必须核对会话索引归属，写 service 必须核对源文件内容 ID。
- 舰船名称与创建引用选项查询必须服从捕获 session 与所属读取票据；切换 session 必须同步清空引用投影，切换 Plain 模式必须撤销创建引用选项的接纳权。
- 表单双向绑定必须经统一 Draft Session setter 提交；保存期间的新编辑必须保留，base 必须更新为实际保存快照。
- 装配与皮肤表单必须作为联合目标交接参与者提供输入提交及所属保存；短暂交接期间必须保持原草稿并锁定所属编辑面。
- 装配改名必须先协调当前 Mod 全部父引用文件的相关编辑并核对实际版本；主文件与父引用必须同根提交，实际基线接纳必须释放所属交接。
- 装配显示名必须由 `ships.name` 与 `variant.displayName` 组合，加载身份必须保持 `variantId`；舰船名称必须按 Mod CSV 优先和 Core 补集解析。
- 路径与文件内容 ID 必须由后端验证；前端扫描或推导一律拒绝。
- 重命名必须由后端验证并交接目标文件与文件内容 ID，前端严禁拼接路径。

## 陷阱

- dirty 时用外部版本直接覆盖表单会丢失未保存编辑。
- 为单一实体族复制整套列表与编辑实现会让族差异漂移成两套行为。
- 在前端推导 `.variant` 或 `.skin` 文件路径会让保存目标脱离后端定义。
- 目录项预取缩略图会在打开新建对话框时产生资源风暴。
- 舰船名称解析失败时回写 `hullId` 到装配数据会破坏引用。
