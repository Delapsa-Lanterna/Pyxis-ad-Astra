# 表格编辑

## 定义

表格编辑模块提供 CSV 数据浏览、字段编辑和所属草稿管理。

## 参考

### 拥有

- `src-tauri/src/commands/tables.rs`：CSV 读取与 patch command。
- `src-tauri/src/services/project/definitions/table_definitions.rs`：表格实体列、摘要、图标及来源选项映射。
- `src-tauri/src/services/project/query/csv_window.rs`：CSV 窗口行、搜索与单行预览查询。
- `src/app/components/TableWorkspace.vue`：表格列表、详情及保存状态组合。
- `src/app/components/tables/`：按需挂载表格、单元格输入、行详情及其行为测试。
- `src/app/components/tables/CsvGrid.vue`：表格网格，拥有可视区调度、列宽与驻留行展示。
- `src/app/components/tables/CsvGridBody.vue`：表体，拥有提前量挂载、屏外隐藏与选中行传递。
- `src/app/components/tables/CsvGridCellEditor.vue`：单元格编辑，按列控件类型分派编辑器。
- `src/app/components/tables/CsvGridRow.vue`：行渲染与选中态。
- `src/app/components/tables/DataTable.vue`：表格工作区组合。
- `src/app/composables/tables/csv-target-ownership.spec.ts`：CSV 显式目标、搜索输入与列状态归属验证。
- `src/app/composables/tables/use-csv-floating-panel.ts`：浮层视口，统一位置、宽度、上下翻转与 resize 释放。
- `src/app/composables/tables/use-csv-grid-media.ts`：网格持有媒体结果到单元格展示的交接接口。
- `src/app/composables/tables/use-csv-grid-viewport.ts`：按需挂载范围、容器尺寸及滚动投影。
- `src/app/composables/tables/use-csv-row-drag.ts`：固定行头拖动、指针捕获、插入目标与边缘滚动。
- `src/app/composables/tables/use-csv-row-preview.ts`：详情行预览、读取票据、失效重读与释放。
- `src/app/composables/tables/use-csv-table-inputs.ts`：表格输入上下文，连接所属输入集合、活动单元格与值提交。
- `src/app/composables/tables/use-csv-table-view-model.ts`：表格 ViewModel，连接 query、store、列 schema 与网格。
- `src/domain/tables/associated-specs.ts`：表格对应规格的打开类型与标识投影。
- `src/domain/tables/csv-column-schema.ts`：CSV 列 schema 与显示顺序投影。
- `src/domain/tables/csv-comment-row.ts`：CSV 注释行标记投影。
- `src/domain/tables/csv-grid-model.ts`：网格列模型。
- `src/domain/tables/csv-search.ts`：搜索项选项与输入提示的纯投影。
- `src/domain/tables/csv-table-rows.ts`：可编辑 CSV 行提取。
- `src/domain/tables/table-detail-actions.ts`：行详情动作与只读预览入口选择。
- `src/domain/tables/table-row-key.ts`：行身份规则。
- `src/services/csv-table.service.ts`：窗口、行预览、资源装配和关联实际目标准备。
- `src/stores/tables.store.ts`：表格运行态，拥有窗口行、选择、dirty、当前表与保存中状态；`initializeModTables` 按 session、Mod 和 manifest 一次建立表格状态与输入集合。

### 消费

- `src-tauri/src/models/tables.rs`：CSV 查询请求、解析记录、搜索与窗口结果。
- `src/domain/schema/schema-registry.ts`：表格消费的列 schema 加载入口。
- `src/shared/lib/starsector/rows.ts`：表格行显示标识与关联规格标识。
- `src/shared/lib/starsector/tables.ts`：游戏表格标准列、模块名称及列排序。
- `src/shared/types/tables.types.ts`：CSV 行、单元格目标、窗口与预览契约。
- `src/stores/project.store.ts`：指定 Mod 的正式清单与 session 查询，异步动作消费捕获目标。
- `src/stores/workspace.store.ts`：当前 Mod、清单与 session 投影，以及按 Mod、表与列持有的持久化列宽。
- `src/test/csv-input-host.ts`：CSV 输入提交的组件测试宿主。
- `src/test/csv-row.ts`：CSV 草稿行的测试构造。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。

### 关联

- `src/shared/lib/starsector/index.ts`：游戏值、颜色与表格规则的转导出入口。
- `src/shared/lib/starsector/value.ts`：JSON 复制、标量转换与 Mod 版本展示。
- `src/shared/types/json.types.ts`：JSON 业务值与输入形状契约。

## 边界

- ViewModel 拥有窗口接纳、搜索和过滤，workspace 提供活动身份。
- 保存归表格编排，撤销重做归草稿历史，身份交接锁由所属运行态提供。
- 列语义来自 schema 加载器，持久化列宽归 workspace 的 Mod、表、列上下文。
- 后端返回窗口行、来源位置与 `rowKey`，tables store 持有行草稿、选择、dirty 和保存状态。
- 控件拥有原文，表输入集合拥有登记与提交，单元格动作以完整 `CsvCellTarget` 交付草稿历史。
- 网格拥有可视窗口、列宽交互与渲染，选中样式消费响应式 `selectedRowKey`。
- 行业务 data、`isComment` 和 `rowKey` 分别表达，来源位置与当前显示位置分别投影。
- 表格运行态与输入集合由 `initializeModTables` 按 session、Mod 和 manifest 建立。

## 链路

### 打开表格窗口

1. 表格进入时按需请求当前表的首批行，并在可视区及提前量范围内继续读取。
2. ViewModel 按完整目标接纳列宽并处理所属草稿保护。
3. CSV 读取能力装配 query identity 与 command，后端返回窗口与源索引。
4. store 按捕获目标写入行、表头与总数，网格按可视区调度并保留已挂载行。

### 编辑单元格

1. 用户激活单元格，所属输入集合提交前一个编辑动作。
2. tables 记录完整活动身份，网格挂载对应编辑控件。
3. 控件登记原始输入并按列 schema 选择输入、选择器或引用选择。
4. 提交经目标化单元格变更边界写入行值并登记一次历史。
5. 已提交行差异进入行脏标记，活动输入差异进入表与 Mod 未保存判定。

### 选择行

1. 用户点击行触发选择事件。
2. store 按捕获 Mod 与表更新 `selectedRowKey`。
3. 行组件按响应式选中态渲染高亮，右侧详情同步刷新。

### 过滤与搜索

1. 用户输入搜索文本或切换 ID/名称、ID、名称、tags 搜索项。
2. ViewModel 提交所属输入并复核目标，更新所属搜索文本与搜索项。
3. 查询接纳消费草稿与活动输入保护状态。
4. 全部行被过滤或无可显示列时显示对应说明。

## 规范

- CSV native 输入必须逐字符保留空串、前导零与数字表示，领域转换必须归所属消费者。
- CSV 保存参与者必须交付所属表草稿与现有输入集合；窗口关闭必须经保存注册表核对目标、草稿、dirty 与输入生命周期。
- CsvGridCell 必须直接持有所属内容容器及浮层锚点引用，活动编辑与静态展示必须消费同一单元格边界。
- Esc 必须取消本次输入；文本浮层、native 输入与选择器必须共用所属集合的保存提交入口。
- 下划线开头的文件列必须按普通业务列显示、编辑和保存；行身份只允许消费记录的 `rowKey`。
- 业务 CSV 字段必须归 `CsvDraftRow.data`；`rowKey`、`sourceRowIndex` 与 `insertAt` 必须分别归所属行记录，严禁写入业务字典。
- 保存期间的表格失效必须合并为后续权威读取；查询必须共同比较原始行基线与版本，自身保存回声只允许更新所属投影。
- 列宽覆盖与测量锁定必须绑定 session、Mod 与表；目标变化必须先接纳所属列宽再处理 dirty 与读取。
- 列宽调整必须即时反映渲染宽度并进入持久化投影。
- 前端新增行只允许使用临时 new key，保存后以后端 `rowKey` map 替换。
- 单元格编辑必须在动作提交边界一次性写值与登记历史；中间输入必须参与未保存判定，行脏标记只允许表达已提交行差异。
- 同值同版本的窗口接纳必须按 `rowKey` 更新来源位置投影，并保留正式草稿、dirty 与活动输入。
- 固定枚举选项必须与目标 Starsector 版本的加载器枚举完全一致。
- 当前展示目标必须消费工作区的当前项目投影，异步动作必须捕获并持续消费所属 Mod 根与 session。
- 拖动必须先提交所属活动输入，校验失败必须保留输入原文、焦点与目标；一次放下必须只提交一次行移动。
- 拖动必须归网格实例，指针取消、Escape、目标变化、保存、基线交接及卸载必须释放所属捕获、插入目标与帧循环。
- 搜索关键词去除首尾空白后非空时必须禁用行排序；搜索项与空关键词组合必须保留排序能力，保存、身份交接及数据准备期间必须禁用拖动。
- 搜索必须去除首尾空白并忽略大小写进行包含匹配；空关键词必须返回全部行，注释行必须按所属业务字段参与搜索。
- 搜索必须属于选择器界面状态；自定义值必须使用显式输入入口并登记待提交状态；多选必须以整个编辑动作一次提交。
- 搜索项切换必须保留关键词并提交活动输入；同 Mod 切表必须恢复 id-name 并清空关键词，返回同一当前表必须保留搜索上下文。
- 搜索项必须由当前权威表头投影；组合项只允许匹配所属 ID 列与 name，单字段项只允许匹配所属字段，缺失字段严禁匹配。
- 未保存行序进入有效搜索前必须提供保存、放弃当前表全部修改与取消；保存成功且所属草稿清理后才允许搜索，搜索交接必须串行并核对所属目标与请求代次。
- 查询窗口必须提供实际 `sourceRowIndex`；网格 rowIndex 只允许表达当前显示位置。
- 滚动、单元格切换与窗口化替换必须先提交所属输入；同目标模型更新必须保持控件，`rowKey` 映射必须保留活动输入的归属。
- 界面刷新必须由所属根登记实际来源与动作，并沿现有保存等待、草稿和外部更新接纳流程执行。
- 窗口读取必须捕获 session、Mod、表、搜索文本、搜索项、状态实例与读取代次；本地动作、保存、重载和卸载必须撤销较早响应与错误的接纳权。
- 缺失列 schema 的列只做文本编辑，严禁猜测控件类型。
- 草稿与 dirty 单元格字典必须保留全部自有列键；缺失列必须以空值展示，严禁消费对象原型上的属性。
- 行预览必须消费捕获的 session、表和 `rowKey`，目标变化及卸载必须释放等待；资源或行预览失效必须合并后读取当前目标。
- 表格窗口、来源集合与行预览必须分别经所属通道接纳结果和错误；来源集合必须在全部目录返回后共同发布。
- 表格窗口必须按可视区及上下各一个视口的提前量请求行，严禁一次加载全表。
- 表格缩略图必须由网格管理可见与邻近资源集合；行组件首次进入提前量时挂载，已访问行必须在当前表内持续驻留，切表、目标替换或卸载时释放所属展示引用与输入登记。
- 选择、编辑与 dirty 只允许消费正式行，严禁把虚拟间隔和占位作为业务记录。
- 选择与文本浮层必须共用视口计算；浮层宽度与水平位置必须服从当前窗口，resize 监听必须随控件释放。
- 顺序草稿必须通过基线源位置与新增行键表达，窗口读取必须映射实际源区间并按当前顺序接纳；同基线的新窗口必须保留已编辑行，外部基线必须进入更新保护。

## 陷阱

- 用 DOM class 维护选中会让虚拟滚动后高亮错位。
- 用数组索引定位行会让排序、过滤与删除后写错行。
- 直接把过滤后行数组当作编辑数据源会让 dirty 写到不可见行。
- 缺失列 schema 时启用引用或枚举控件会让无来源列发起空查询。
- 让编辑控件直接调用保存会让局部输入绕过 dirty 与历史链路。
