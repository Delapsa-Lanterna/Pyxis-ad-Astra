# 联合编辑与目标交接

## 定义

联合编辑与目标交接模块协调多个编辑面的实际目标、来源快照、字段冲突和同根原子保存。

## 参考

`src-tauri/src/commands/joint_edit.rs`：联合读取、准备、提交 command owner。
`src-tauri/src/domain/joint_edit.rs`：三方业务值比较与冲突投影 owner。
`src-tauri/src/domain/joint_hull.rs`：有效舰体字段来源、Skin继承与有效武器槽的纯投影 owner。
`src-tauri/src/models/joint_edit.rs`：联合根、来源记录、缺失值、冲突与提交模型 owner。
`src-tauri/src/services/project/query/joint_edit.rs`：四类根、来源图、CSV 目录及版本装配 owner。
`src-tauri/src/services/project/write/joint_edit.rs`：联合 changeset、实际快照、行键和身份交接 owner。
`src/app/components/JointEditConflictChoices.vue`：三个来源与字段选择展示 owner。
`src/app/composables/use-edit-target-handoff.ts`：窗口接收与目标登记生命周期 owner。
`src/app/composables/use-joint-edit-actions.ts`：确认、冲突选择和领域动作装配 owner。
`src/app/composables/use-joint-edit-session.ts`：消费编辑会话原语的联合目标适配器。
`src/app/composables/use-table-save-participants.ts`：主窗口后台 CSV 保存交接适配器。
`src/domain/joint-edit.ts`：物理范围比较、冲突选择与文本投影 owner。
`src/orchestrators/edit-target-handoff.orchestrator.ts`：保存准备、跨窗口请求、预约及释放 owner。
`src/orchestrators/joint-edit.orchestrator.ts`：联合读取、冲突确认与提交顺序 owner。
`src/services/joint-edit.service.ts`：三个 command 的类型化协议装配 owner。
`src/shared/types/joint-edit.types.ts`：前端联合记录、冲突及交接协议 owner。
`src/stores/save-command.store.ts`：保存参与者、所属句柄和短暂交接锁登记 owner。

## 边界

- CSV、配置、文本与专项会话必须拥有各自草稿、活动输入、dirty、saving 和历史；联合编排只允许消费参与者登记和正式保存动作。
- 业务目标与物理写入范围必须分别表达；同一 CSV 文件的不同记录必须共同服从文件版本和交接范围。
- 原生窗口模块必须拥有实例 label、登记、聚焦和预约；联合模块必须拥有按业务目标捕获的请求与释放责任。
- 后端必须拥有实际来源、授权写入目标、描述记录、关联图和版本；前端只允许对返回记录进行领域投影和独立草稿装配。
- 联合查询与提交必须分别归 project query 和 write；命令必须经现有根事务、版本校验和 receipt 提供持久化交接。
- 配置表单、文本与专项窗口必须登记当前来源版本覆盖的物理范围；主窗口必须登记所有已加载 CSV 的所属保存动作。
- CSV 保存参与者必须共同消费 manifest 身份与表格运行态初始化；表格初始化完成后必须登记，运行态释放后必须撤销，同 session 的 manifest 投影更新必须保留参与者及所属锁。
- 参与者必须捕获登记时的正式物理目标；所属 manifest 释放到参与者清理完成期间，目标集合必须保持完整身份并由原登记释放。
- 每个窗口壳必须建立一次接收与目标登记生命周期，卸载必须撤销监听及所属登记。

## 链路

### 联合读取

1. 动作以 session、Mod、种类和 ID 请求联合来源快照。
2. 后端以根租约读取规格、CSV、描述、Core 补集、Skin 和模块来源。
3. 来源目录按类型及表准备，返回记录身份、来源版本、写入目标和引用关系。
4. 编排完成相关编辑面保存交接后重新读取权威快照。
5. 编辑会话建立独立草稿与基线。

### 目标交接

1. 请求捕获目标集合和来源窗口，定位本地与原生登记的相关参与者。
2. 等待所属保存及 pending 同步，提交活动输入并核对目标。
3. 用户确认相关未保存内容，参与者依次执行正式保存。
4. 准备完成后持有所属短暂锁，接收方返回 receipt。
5. 编排取得原生预约并执行所属读取或提交。
6. 实际基线接纳后释放本地锁、远端准备和原生预约。

### 冲突与提交

1. 后端比较原始基线、权威磁盘和提交草稿。
2. 独立字段合并，重叠差异返回结构化冲突。
3. 用户按字段选择磁盘或草稿，确认共享影响及 Mod 覆盖。
4. 命令取得根事务并核对确认版本。
5. write 装配规格身份、CSV 记录及描述到同一 changeset，完成 JSON 确认后原子应用。
6. 返回实际快照、身份、行键、版本及文件历史；会话先接纳基线，再执行正式同步与广播。

## 规范

- JointEditRoot 必须完整表达 sessionId、modRoot、kind 和 id；四类根必须为 ship、weapon、wing 与 variant。
- JointEditQuery 必须分别承载正式根、可选 CSV rowKey、草稿值与newSources；rowKey 必须由后端解析已保存 ID，草稿关联投影必须消费独立捕获值。
- JointHullProjection必须表达装配、基础舰体、Skin链、实际字段绑定、有效武器槽与授权贴图；有效值必须按继承顺序投影，字段提交必须消费所属recordKey与path。
- newSources只允许声明关联图中的ship、variant与skin创建类型及ID；准备必须捕获新增关联的Mod版本，保存必须核对原目标与不存在凭据。
- Mod写入版本必须保持所属根范围；Core来源必须消费独立sourceVersion核对，授权Mod覆盖目标必须保留不存在凭据。
- 共享关系必须沿舰体、Skin与装配反向展开至实际联队；确认必须呈现实际来源、写入文件与关联对象。
- 联队CSV改名必须以原rowKey解析权威ID，描述身份必须继续消费实际舰体来源；引用提交后必须按实际磁盘重读新的来源与版本。
- Skin缺少descriptionId时必须消费skinHullId，显式空引用必须呈现缺失状态；恢复默认描述必须通过明确字段移除动作提交。
- 联合快照必须提供根记录 bindings、只读关联与配置来源版本；舰船系统必须消费 CSV system id，传感器配置必须按 Core 与 Mod 来源装配。
- 目标适配器必须声明可编辑记录集合；草稿、三方比较、共享影响确认与保存协调只允许消费该集合。
- createOverrides 必须表达明确的 Core 原样创建记录；返回目标必须接纳实际 CSV linkedRecord、rowKey 与身份映射。
- 默认舰船描述键必须由所属身份规则随 hullId 改名；联合提交必须接纳描述记录的实际 ID、行键、bindings 与版本，显式 descriptionId 只允许由明确字段动作改变。
- 武器描述必须按武器 ID 与 WEAPON 类型读取；武器 ID 改名必须在同一事务中更新所属描述记录，目标描述占用必须拒绝整次保存。
- 联合武器关联投影必须按当前草稿的 projectileSpecId 与伤害类型返回弹体来源和配置授权图标；配置版本必须参与关联失效。
- 缺失舰船与武器规格必须消费所属正式构造器；武器创建必须携带合法 projectile 或 beam 分支，未知业务字段必须保留。
- JointRecordTarget 必须分别表达规格、CSV 与文本；CSV 必须具有 table、rowKey、业务 identity 和授权 write。
- JointValue 必须区分 missing 与 present；null、删除、数组和文本原文必须保持各自语义。
- 三方比较必须按对象字段路径与 CSV 记录内容执行，数组与文本必须整体选择；独立修改必须保留两侧业务内容。
- CSV 来源目录必须一次准备所属表的身份索引；行键匹配必须保持注释身份与 description 的 id/type 组合。
- Core 来源必须携带来源版本与当前 Mod 创建凭据；覆盖修改必须经显式确认并写入授权 Mod 目标。
- JSON 更新必须消费当前设置与指纹确认；规格身份必须消费所属定义，CSV 必须保留行序、业务值、未知列与注释身份。
- CSV 补列必须以明确字段提交为依据；标准列必须按已配置 Core 表头或正式列资产排序，自定义列必须保持相对顺序并位于末尾。
- 保存确认必须绑定当前版本，确认后的来源变化必须返回版本冲突并保留草稿。
- 联合提交必须只应用一次 changeset、登记一次文件历史；写后结果必须由实际 after 快照装配版本。
- 保存期间新增编辑必须保留；参与者保存后仍有 dirty 时必须结束交接并释放占用。
- 交接请求必须携带 requestId、ownerLabel、receiverLabel 和完整目标；回复与释放必须核对同一身份。
- 重复目标交接必须复用进行中请求；参与者释放、目标变化和窗口销毁必须撤销原响应接纳权。
- 联合打开必须以所属 ReadTicket 接纳快照；替换和卸载必须撤销打开及交接等待。跨窗口同时发起重叠目标交接必须结束冲突请求并保持原草稿。
- 输入错误、取消、保存失败与同步失败必须保持所属编辑面；跨窗口错误必须聚焦其 owner 并保留正式诊断。
- 短暂锁必须覆盖提交与基线接纳；取消、失败、销毁和会话结束必须释放原请求登记。
- receipt 同步必须消费现有 write-sync；再次保存必须先完成原 receipt，再捕获最新输入。
- 联合基线的写后重读必须消费提交通知的投影阶段，并等待身份阶段完成；所属会话释放必须撤销基线与关联读取。

## 陷阱

- 严禁把可变草稿放进跨窗口全局登记。
- 严禁按活动 Mod 或显示文本补齐实际写入身份。
- 严禁分别写入联合 changeset 的各文件后再组合 receipt。
- 严禁将确认前的旧来源当作确认后的权威版本。
- 严禁用第二套 dirty 或保存状态替代编辑会话。
