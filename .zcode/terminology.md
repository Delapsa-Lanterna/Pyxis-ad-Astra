# 产品术语

本文档只统一产品、UI 和维护文档使用的 Starsector 领域对象、文件对象、字段边界和关键用户可见约束。

## 使用规则

- 产品界面和维护文档使用中文产品名；英文 canonical name 用于 Starsector 资料、代码和跨文档引用。
- 固定术语、字段名和枚举值必须使用 Markdown 反引号。
- 游戏术语依据中文游戏文本核对；字段含义依据 API 定义及原版实际读取、计算和界面展示核对。
- 每个字段必须注明所属对象；同名字段不能跨对象直接推断语义。
- `CSV row`、spec 数据、spec 文件和画布对象表示不同边界，词条必须按实际边界使用。
- 本表只定义产品领域对象、文件对象、字段边界和用户可见约束；编辑会话、版本、同步和生命周期术语由所属模块定义。

## 配置与实体对象

### 舰船 Ship

- **对象边界**：舰船业务记录、`.ship` spec 和舰船贴图引用。
- **所属数据**：CSV `id`、CSV `name`、spec `hullId`、spec `hullName`。
- **定义**：Ship 是可在舰船编辑器中编辑几何、槽位、引擎、护盾和贴图引用的舰船对象。
- **不要混用**：CSV `name` 是表格业务名称；spec `hullName` 是规格内容；两者不是同一个字段。

### 武器 Weapon

- **对象边界**：武器 CSV 业务记录、`.wpn` spec、发射点和武器贴图引用。
- **所属数据**：CSV `id`、武器类别 `type`、spec `specClass`、spec `projectileSpecId`。
- **定义**：Weapon 是描述武器类别、发射方式、弹体引用或光束效果的武器对象。
- **不要混用**：武器类别 `type` 与 `.wpn` 的编辑分支 `specClass` 分别表达游戏类别和规格分支。

### 弹体 Projectile

- **对象边界**：`.proj` spec、弹体贴图、碰撞尺寸、速度和引擎参数。
- **所属数据**：`.proj` `id`、`specClass=projectile/missile`、`spawnType` 或 `missileType`。
- **定义**：Projectile 是武器发射后使用的弹体或导弹规格对象。
- **不要混用**：产品词 `弹体` 覆盖 `projectile` 和 `missile`；代码分支必须使用实际 `specClass` 区分两者。

### 装配 Variant

- **对象边界**：`.variant` spec 及其舰船、武器、插件、战机联队和系统装配引用。
- **所属数据**：`variantId`、`hullId`、槽位和装配引用。
- **定义**：Variant 是舰船装配配置对象，不是舰船 spec 本身。
- **不要混用**：严禁写成 `loadout`，严禁翻译为 `变体`。

### 船体插件 Hullmod

- **对象边界**：`hullmods` CSV 中登记的 Hullmod，以及 `.variant`、`.skin` 和 `.ship` 中的相关引用。
- **定义**：Hullmod 统一称为 `船体插件`；普通、永久和 S-mod 是其安装类别或强化状态。

### 战机联队 Wing

- **定义**：Wing 统一称为 `战机联队`；其中的 `num` 称为 `联队战机数量`。
- **字段名称**：`refit` 称为 `战机更换时间`，单位为秒；联队详情的 `min crew` 称为 `必要船员（每架）`，来源为所用舰船的船员字段。
- **战术应用**：`role` 称为 `战术应用`，`role desc` 称为 `战术应用说明`；联队详情优先显示 `role desc`，为空时显示 `role` 的中文名称。

### 皮肤 Skin

- **对象边界**：`.skin` spec 及其基础船体、贴图变化和装配变化。
- **所属数据**：`skinHullId`、`baseHullId`、slot change 和 engine change。
- **定义**：Skin 是基于船体的外观或装配变化对象。
- **不要混用**：`skinHullId` 是皮肤身份；`baseHullId` 是被覆盖的基础船体身份。

### 势力 Faction

- **对象边界**：势力索引 CSV、实际 `.faction` 文件、势力名称、颜色、logo 和 crest 引用。
- **所属数据**：索引行提供文件引用；`.faction` 内容提供势力业务字段。
- **定义**：Faction 是由索引记录和势力规格文件共同构成的势力对象。
- **不要混用**：严禁翻译为 `阵营`。

### 战役 Mission

- **对象边界**：`data/missions/mission_list.csv`、任务目录、`descriptor.json` 和 `mission_text.txt`。
- **所属数据**：索引列 `mission`、descriptor 字段、任务文本和目录资源。
- **定义**：Mission 是由任务索引、任务目录和任务描述内容共同构成的战役对象。

### 战术系统 System

- **对象边界**：`.system` spec 及其 schema 字段和编辑集合。
- **所属数据**：系统 ID、`type`、`aiType` 以及系统效果字段。
- **定义**：System 是舰船战术系统规格对象。

### 技能 Skill

- **对象边界**：技能数据记录、`governingAptitude` 和 `effectGroups`。
- **所属数据**：技能 ID、控制属性字符串和效果组数组。
- **定义**：Skill 是由控制属性和效果组描述的技能对象。

## 表格与文件对象

### CSV table

- **定义**：CSV table 是一个保留原表头、业务列、行序和注释行的可编辑表格文件。
- **对象边界**：表格名称、表头、CSV row 和文件内容；不等同于某个实体 spec。

### CSV row

- **定义**：CSV row 是表格中的一条业务记录，包含业务列值和行身份。
- **对象边界**：业务列属于 CSV row；工具使用的行身份、来源位置和势力注解不属于业务字段。
- **不要混用**：同名业务列和工具元数据必须分别按其记录边界读取。

### spec file

- **定义**：spec file 是 Starsector 使用的规格文件，保存实体的结构化业务内容。
- **对象边界**：文件路径、文件名、JSON-like 内容和关联引用分别表达文件对象、身份和业务内容。

### `mod_info.json`

- **定义**：`mod_info.json` 是 Mod 的工具可编辑元数据文件，保存 Mod 名称、版本、作者和依赖等信息。
- **对象边界**：它描述 Mod，不是 Ship、Weapon 或其它游戏实体的 spec。

### ResourceRef

- **对象边界**：资源来源、资源路径、字段键和所属对象引用。
- **定义**：ResourceRef 是对 Mod 或 Core 资源的结构化引用，不是已加载的图片数据。
- **不要混用**：ResourceRef 表示引用；data URL 表示读取后的媒体内容；二者不能互相替代。

## 编辑器相关产品词汇

### Ship Editor

- **定义**：Ship Editor 是编辑 `.ship` 结构、槽位、引擎、护盾、边界和贴图引用的编辑器。

### Weapon Editor

- **定义**：Weapon Editor 是编辑 `.wpn` 内容、发射点、炮管角度、光束字段和弹体引用的编辑器。

### Projectile Editor

- **定义**：Projectile Editor 是编辑 `.proj` 的 projectile 或 missile 分支、碰撞、尺寸、速度和引擎参数的编辑器。

### configuration editor

- **定义**：configuration editor 是编辑 Faction、Mission、Variant、Skin、System、Skill 和 Mod 信息的配置编辑器集合。

### weapon preview

- **定义**：weapon preview 是展示武器发射点、弹道或光束效果的只读产品视图。
- **对象边界**：预览可以消费已保存 bundle 或一次性草稿快照，不直接写入文件，不发送保存动作。

### canvas object

- **定义**：canvas object 是画布中表示发射点、槽位、引擎或几何点的可交互对象。
- **对象边界**：画布对象是编辑视图投影，不等同于完整 spec 文件。

### barrel、turret offset、hardpoint offset

- **barrel**：武器发射点的产品称呼。
- **turret offset**：炮塔视图使用的 `turretOffsets` 与 `turretAngleOffsets`。
- **hardpoint offset**：固定炮视图使用的 `hardpointOffsets` 与 `hardpointAngleOffsets`。
- **不要混用**：炮塔数组和固定炮数组属于不同视图，不能互相配对或覆盖。

### field value、resource reference、business value

- **field value**：字段控件正在编辑的字段值。
- **resource reference**：字段中的资源引用，通常由 ResourceRef 表达。
- **business value**：属于业务文件或业务记录的实际值，不包含工具运行时投影。

## 字段与枚举边界

- Hull 统一称为 `船体`；Ship 统一称为 `舰船`。
- `Codex` 统一称为 `数据百科`。
- CSV `tech/manufacturer` 和 Skin `tech` 的界面名称为 `设计类型`。

### 舰船字段

- `hullSize` 使用 `FIGHTER`、`FRIGATE`、`DESTROYER`、`CRUISER`、`CAPITAL_SHIP`，界面称为 `船体级别`。
- `hitpoints` 在舰船详情称为 `船体结构值`，装配统计称为 `船体结构`；`armor rating` 在舰船详情称为 `装甲值`，装配统计称为 `船体装甲`。
- `max speed` 称为 `最高航速`，`max burn` 称为 `最大宇宙航速`；`min crew`、`max crew`、`cargo` 分别称为 `必要船员`、`最大载员`、`载货量`。
- `min crew` 与 `max crew` 合并展示时称为 `船员配额`。
- `peak CR sec` 称为 `峰值时间`；`sensor profile` 称为 `传感器截面`，`sensor strength` 称为 `探测范围`。
- `supplies/rec` 称为 `战备恢复成本 (补给)`；基础 `部署点数` 也取此字段，插件效果归所属统计处理。
- `supplies/mo` 称为 `维护消耗 (补给/月)`。
- 防御方式中的 `FRONT`、`OMNI`、`PHASE` 分别称为 `前盾`、`全盾`、`相位线圈`；`Phase Cloak` 称为 `相位线圈`。
- `style` 使用 `LOW_TECH`、`MIDLINE`、`HIGH_TECH`、`CUSTOM`，表示数据字段，不表示 UI 主题。
- 几何字段包括 `center`、`shieldCenter`、`shieldRadius`、`collisionRadius` 和 `bounds`。
- 槽位字段包括 `weaponSlots`、`engineSlots`、`id`、`size`、`type`、`mount`、`angle`、`arc` 和 `locations`。
- `战机甲板` 表示所属槽位或区域；甲板 `locations` 中的具体坐标点称为 `起降口`。
- 贴图相关字段使用资源引用；`spriteName` 和 `viewOffset` 不能被解释为同一个概念。

### 武器字段

- 武器类别 `type` 使用 `BALLISTIC`、`ENERGY`、`MISSILE`、`DECORATIVE`。
- `.wpn.specClass` 使用 `projectile` 或 `beam` 表示武器规格分支。
- `barrelMode` 使用 `ALTERNATING` 或 `LINKED`。
- 武器组 `LINKED` 称为 `齐射`，`ALTERNATING` 称为 `交替`。
- 武器详情的 `primaryRoleStr` 展示标题为 `战术应用`。
- 武器详情中的 `accuracy`、`tracking` 分别称为 `精确度`、`追踪能力`；CSV `proj hitpoints` 称为 `弹体结构值`。
- 武器详情的再次射击周期称为 `开火间隔`，由所属武器的充能、连射和冷却参数计算。
- 武器详情的 `ammo` 在能量武器中称为 `充能`，有回充时称为 `最大充能量`；其它武器称为 `备弹量`，有装填时称为 `最大备弹量`。
- 武器详情的 `reload size` 在能量武器中称为 `单次回充量`，其它武器称为 `单次装填量`。
- 光束字段包括 `fringeColor`、`coreColor`、`glowColor`、`textureType`、`textureScrollSpeed`、`convergeOnPoint` 和 `darkCore`。
- `textureType` 使用 `ROUGH`、`SMOOTH` 或 `NONE`。

### Projectile 与 missile 字段

- `specClass=projectile` 使用 `spawnType` 和 `bulletSprite`。
- `specClass=missile` 使用 `missileType` 和 `sprite`，并可编辑导弹引擎参数。
- `collisionRadius`、`bounds` 等同名字段必须按所属对象解释。
- 舰船引擎位置通常使用 `location`；弹体引擎位置通常使用 `loc`。

### 配置实体字段

- Variant 使用 `variantId` 和 `hullId`；Skin 使用 `skinHullId` 和 `baseHullId`。
- Variant 的 `fluxCapacitors` 称为 `幅能寄存器`，`fluxVents` 称为 `耗散通道`；舰船 `ordnance points`、武器 `OPs`、联队 `op cost` 和皮肤 `ordnancePoints` 均称为 `装配点数`。
- Mission 使用索引列 `mission`，并关联任务目录中的 descriptor 和文本。
- Faction 的索引引用与 `.faction` 文件内容分别属于索引记录和势力业务文件。
- Faction 的 `factionDoctrine` 称为 `舰队学说`，其中 `aggression` 称为 `侵略性`；`offersCommissions` 称为 `提供雇佣协议`，`buysSurveyData` 称为 `收购调查数据`。
- System 使用系统 ID、`type`、`aiType` 和系统效果字段；Skill 使用技能 ID、`governingAptitude` 和 `effectGroups`。
- 战术系统 CSV 的 `f/s (base rate)`、`f/s (base cap)` 分别称为 `每秒幅能（耗散系数）`、`每秒幅能（容量系数）`。
- 战术系统 CSV 的 `f/u (base rate)`、`f/u (base cap)` 分别称为 `单次幅能（耗散系数）`、`单次幅能（容量系数）`。
- 上述战术系统字段中的 `base rate` 系数乘以基础幅能耗散，`base cap` 系数乘以基础幅能容量。

### CSV 业务列与工具元数据

- 业务列是游戏文件中的正式内容，搜索、编辑和保存必须按业务值处理。
- `rowKey`、来源行位置、插入位置和势力注解是表格工具记录，用于窗口化、身份和投影。
- 工具元数据不能写回成业务列，也不能替代 CSV 原有表头和值。

## 产品约束

- 结构化武器 spec 只允许 `projectile` 和 `beam`。
- `pulse` 只允许读取和修正已有内容；结构化武器保存严禁使用 `pulse`。pulse 在原版中无法正常处理，武器类型只允许 projectile 和 beam。
- Weapon 的 `type` 与 `.wpn.specClass` 分别表达武器类别和编辑分支。
- Weapon 的 `.proj` 引用与 Projectile 的 `specClass` 不等价。
- weapon preview 是只读产品视图，可以消费当前编辑草稿快照，但不直接写入文件。
- `preview` 表示打开预览的交互名称，不表示保存或编辑动作。
