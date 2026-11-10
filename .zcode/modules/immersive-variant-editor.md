# 沉浸式装配编辑器

## 定义

沉浸式装配编辑器模块提供装备、插件、武器组和模块导航的联合编辑。

## 参考

### 拥有

- `src/app/components/immersive/ImmersiveFilterGroup.vue`：装配候选筛选分组。
- `src/app/components/immersive/ImmersiveFilterToggle.vue`：装配候选筛选开关。
- `src/app/components/immersive/ImmersiveGameFrame.vue`：装配场景与候选的游戏外观容器。
- `src/app/components/immersive/ImmersiveResourceIcon.vue`：装配候选资源图标。
- `src/app/components/immersive/ImmersiveSquareToggle.vue`：装配开关控件。
- `src/app/components/immersive/ImmersiveTooltipFrame.vue`：装配候选悬浮信息容器。
- `src/app/components/immersive/variant/`：装配、候选、插件及武器组交互组件。
- `src/app/composables/immersive-editor/variant/`：装配动作、候选目录及候选详情读取。
- `src/app/composables/use-immersive-hover.ts`：装配候选悬浮目标、延时与释放。
- `src/assets/immersive/controls/`：装配控件的本地回退资产。
- `src/domain/immersive/variant/`：预算、装备、插件、筛选和分组纯规则。

### 消费

- `src/app/components/immersive/ImmersiveFallbackIcon.vue`：伤害类型、插件与甲板的共用缺省图标。
- `src/app/components/immersive/ImmersiveHullScene.vue`：船体场景的媒体、导航与绘制装配。
- `src/app/components/immersive/ImmersiveHullThumbnail.vue`：通过正式船体绘制交付静态成品。
- `src/app/components/immersive/ImmersivePanelRow.vue`：共同字段行及标签排布。
- `src/app/components/immersive/ImmersiveText.vue`：沉浸式文本片段与字体角色展示。
- `src/app/components/immersive/ImmersiveWeaponIcon.vue`：武器图层与已装载导弹的缓存图标展示。
- `src/app/components/immersive/immersive-render-context.ts`：只读与编辑展示契约。
- `src/app/components/immersive/ship/ShipImmersivePanel.vue`：舰船内容与静态贴图展示组件。
- `src/app/components/immersive/weapon/WeaponImmersivePanel.vue`：武器内容与弹体及开火预览事件入口。
- `src/app/components/immersive/wing/WingImmersivePanel.vue`：战机联队内容及来源字段展示。
- `src/app/components/media/ResourceThumbnail.vue`：授权图片与配置选项消费的缩略图展示。
- `src/app/composables/immersive-editor/use-immersive-editor-runtime.ts`：联合会话、历史、字段与关联读取运行态。
- `src/app/composables/immersive-editor/use-immersive-thumbnails.ts`：交付武器与船体缩略图的实际绘制参数、依赖和成品需求。
- `src/app/composables/use-app-feedback.ts`：窗口反馈的提供与消费入口。
- `src/app/composables/use-original-fonts.ts`：窗口字体运行态、读取票据、逐项接纳、日志与响应式测量。
- `src/app/composables/use-resource-media-registry.ts`：持有集合差量、业务引用、媒体租约与所属反馈。
- `src/app/composables/use-resource-thumbnail.ts`：交付普通缩略图需求与静态成品展示生命周期。
- `src/app/composables/use-thumbnail-preload.ts`：可见优先与邻近预读队列的资源集合消费。
- `src/app/composables/use-visible-resource-media.ts`：可视区媒体解析。
- `src/domain/fonts/`：FNT 解析、字体类型、样式、分段排布与墨迹范围计算。
- `src/domain/immersive/appearance.ts`：沉浸式缩放、主题与颜色投影。
- `src/domain/immersive/design-type.ts`：设计类型名称及颜色规则。
- `src/domain/immersive/fields.ts`：字段规则、数值投影与具名关联查询输入契约。
- `src/domain/immersive/font-roles.ts`：沉浸式文本角色到字体样式的投影。
- `src/domain/immersive/hull-fields.ts`：船体基础与皮肤字段的统一读取、计算与输入投影。
- `src/domain/immersive/hull-scene.ts`：有效船体、装备层序、坐标与编队投影。
- `src/domain/immersive/ship/ship-panel.ts`：舰船来源、后勤、战斗、装备投影及系统与防御关联查询输入投影。
- `src/domain/immersive/source-records.ts`：可编辑来源与装配记录选择。
- `src/domain/immersive/weapon-icon.ts`：挂载颜色与形状纯投影。
- `src/domain/immersive/weapon/`：武器字段、统计与关联查询的纯投影。
- `src/domain/immersive/wing/wing-panel.ts`：技术信息、来源绑定与编队输入投影。
- `src/domain/joint-edit.ts`：联合写入范围提取、身份映射、草稿重接与冲突选择投影。
- `src/domain/schema/`：字段与列资产加载、游戏数字解释、来源声明、校验及目标格式准备。
- `src/orchestrators/project-sync.orchestrator.ts`：窗口内保存消费过程和内容维护者交接。
- `src/services/joint-edit.service.ts`：三个 command 的类型化协议装配。
- `src/shared/lib/starsector/variant-modules.ts`：Variant 模块字段的对象/数组读取与写回。
- `src/shared/runtime/app-log-queue.ts`：候选实际挂载、隐藏、恢复及释放的详细记录。
- `src/shared/runtime/use-layout-frame.ts`：候选尺寸与位置测量的帧合并及作用域释放。
- `src/test/fixtures/joint-edit/variant-joint-edit.ts`：装配、模块与装备来源的测试构造。

## 边界

- 候选运行态拥有目录、详情、媒体及所属读取。
- 共同运行态拥有联合会话、草稿、历史及保存。
- 场景消费共用船体与装备投影，安装和卸下归装配动作。
- 武器组拥有独立临时值，通过输入终结交付一次会话动作。
- 装配内容消费舰船、武器和战机联队的只读信息入口。
- 装配实现拥有模块导航、确认意图和在途装备动作。

## 链路

### 选择与装备

1. 用户操作实际槽位、甲板或插件入口，先交接活动输入。
2. 所属目录提供摘要，悬停或焦点读取独立详情。
3. 动作核对兼容性与来源，确认后交付一次联合草稿及历史。
4. 保存经共同会话和正式事务提交实际修改集合。

### 模块与清空

1. 导航捕获实际模块并提交所属输入。
2. 清空捕获根与递归模块的实际记录和共享影响。
3. 确认后原子更新当前草稿集合并登记一次历史。
4. 取消、来源变化或释放结束所属请求接纳。

## 规范

- 强制装备确认必须逐项交付原装备、候选、槽位、来源和完整诊断；清空展开全部装配及共享对象，武器组冲突通过下拉选择所用分组并支持展开查看其余完整内容。
- 候选卡直接消费目录摘要，完整详情由悬停或焦点按独立通道读取；当前装备与详情绑定实际非空 ID，Ctrl 比较使用独立只读投影。
- 候选图像必须由列表管理可见与邻近集合；候选首次进入可视区及上下各一个视口的提前量时挂载，窗口图片运行态保留已接纳解码和成品，重新可见同步消费当前来源的就绪结果，选择器关闭或目录身份切换时释放所属实例、活跃引用与等待。
- 候选目录按 Mod 优先、Core 补集读取，搜索和筛选消费排序后的完整目录；三类候选默认按 OP 降序，同成本保持相对顺序，缺失成本保留诊断并置于末尾。
- 模块候选按原版、本 MOD、引用 MOD 顺序提供独立来源开关，每次打开只选本 MOD；候选按实际来源取选中并集，空选择产生空列表，本 MOD 与引用 MOD 共用目录读取并共同决定读取生命周期。
- 强制安装与手填 ID 必须共用 ViewModel 动作；确认接纳核对捕获目标、草稿、输入及候选版本，取消保留当前装备和选择器，成功登记一次历史。
- 武器与战机候选选择后必须由当前编辑窗口分别记住，模块切换保留；Shift + 左键对兼容且预算充足的武器槽位或战机甲板直接安装并登记一次联合历史。
- 最近选择不满足武器槽位兼容或装配点数时必须保留选择、不修改草稿且不展开选择器；反馈提示普通点击目标以在选择器中继续安装，右下角分别展示已记住的武器与战机提示及名称。
- 插件两组筛选必须按目录去重计数，组内取并集、组间取交集；普通点击单选当前项，Ctrl／Shift 切换多选，取消最后一项恢复全选。
- 插件目录消费 `hidden`、`hiddenEverywhere`、设计类型与 `uiTags`，缺失设计类型采用 Common；成本消费当前船体级别，安装状态来自实际装配集合。
- 插件静态详情消费 `desc`、`short`、`sModDesc`，脚本参数使用明确占位；安装与类别转换更新所属草稿并保持选择器。
- 普通、永久与 S 插件动作必须共同调整 `hullMods`、`permaMods` 和 `sMods` 的包含关系；`sModdedBuiltIns` 只允许展示已有强化状态。
- 武器候选必须过滤 CSV `hints` 与规格 `aiHints` 中的完整 `SYSTEM` 标记；筛选优先消费 `mountTypeOverride`，类型排和尺寸排各取并集、两排取交集，空选择产生空列表。
- 武器归组必须消费全部已装与有效内置武器，每个槽位属于一个组；Shift 批量按相同武器 ID 与挂载匹配，模式和持续幅能消费所属组投影。
- 武器筛选初值必须消费当前槽位的原版类型和尺寸规则；安装校验核对有效类型、尺寸、指定挂载限制和 `SYSTEM`，强制安装显式呈现槽位、候选、来源与原因。
- 武器组必须建立独立七组临时值与比较基线，保留空组及未知组字段；相等提交保持会话相等，调整确认或保存登记一次联合历史，取消恢复打开前分组。
- 清空必须保留内置装备、内置 S 强化、名称、船体及模块引用与未知字段；确认期间目标、模块集合、草稿或原文变化结束请求并保留最新内容。
- 清空必须捕获当前装配及递归模块并按实际记录键去重，确认展示实际文件与共享影响；可编辑装备、插件与幅能分配形成一条联合历史。
- 装配可编辑集合必须由根和模块引用图确定；同一模块共享实际记录键、草稿与版本，模块导航提交活动输入并保留全部所属草稿。
- 装配基础船体统计只允许查看来源；预算计入可编辑武器、非内置战机联队、普通插件及幅能分配，内置装备和永久插件按零 OP 计费。
- 装配字段身份必须表达根与模块槽位角色，改名共同映射记录键、输入、历史与导航；保存期间新增输入和草稿按实际基线保留。
- 装配容量与耗散消费有效船体基础值及配置 `fluxPerCapacitor`、`dissipationPerVent`；超预算、超船体级别上限、不兼容和缺失引用提供定位诊断并允许保存。
- 幅能寄存器和耗散通道加减按钮必须单击调整 1、长按连续调整；按住 Shift 缩短重复间隔。首次增加超过船体等级基础上限时必须确认，授权在当前窗口共享并允许两项继续增加；取消结束当前长按。
- 装配武器替换必须保留所属组，新增进入首组；战机联队卸下保留甲板索引，内置装备保持所属来源权限。
- 整舰武器幅能及来源明细共同消费实际类型为战斗武器的装备集合，装饰装备通过武器类型判定。
