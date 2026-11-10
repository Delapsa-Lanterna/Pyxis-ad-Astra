# 武器开火预览

## 定义

武器开火预览模块提供独立窗口中的只读武器发射模拟与播放控制。

## 参考

### 拥有

- `src/app/WeaponFirePreviewContent.vue`：加载状态、稳定预览实例与关闭动作的装配入口。
- `src/app/components/weapon-fire-preview/`：开火预览控制、画布与行为测试。
- `src/app/composables/weapon-fire-preview/`：预览来源、读取、播放与模拟生命周期。
- `src/app/renderers/weapon-fire-preview/`：开火预览静态贴图和模拟阶段绘制。
- `src/domain/weapon-fire-preview/`：开火时序、弹体、光束及模拟参数规则。
- `src/orchestrators/weapon-fire-preview.orchestrator.ts`：预览原生身份、标题与窗口上下文交接。
- `src/services/weapon-fire-preview.service.ts`：武器来源及完整弹体只读装配、依赖错误。
- `src/windows/weapon-fire-preview.window.ts`：完整预览身份、来源、标题与尺寸的请求入口。

### 消费

- `src/app/components/editors/common/EditorFooter.vue`：编辑与预览共用的说明及操作插槽。
- `src/app/components/editors/common/EditorHeader.vue`：编辑与预览共用的标题、dirty、外部基线及动作插槽。
- `src/app/components/editors/common/EditorInspector.vue`：编辑与预览共用的属性区标题及独立滚动容器。
- `src/app/composables/canvas/`：画布表面、视口、导航、选择、指针与展示运行态。
- `src/app/composables/editors/use-editor-frame-loop.ts`：帧循环的启动、停止与释放。
- `src/app/composables/editors/use-engine-rendering.ts`：统一装配引擎样式查询、媒体、解码、着色成品与引用释放。
- `src/app/composables/editors/use-projectile-rendering.ts`：统一持有开火图片租约、解码与着色成品。
- `src/app/composables/use-app-feedback.ts`：窗口反馈的提供与消费入口。
- `src/app/composables/use-context-menu.ts`：窗口菜单状态、目标操作、事件生命周期与业务根登记。
- `src/app/composables/use-managed-window-requests.ts`：组件作用域内请求接纳及释放适配。
- `src/app/composables/use-window-close-state.ts`：窗口操作锁、具名关闭请求、内容参与登记和卸载释放。
- `src/app/composables/use-window-shortcuts.ts`：统一窗口按键监听、菜单优先、关闭屏蔽及卸载释放。
- `src/app/renderers/editors/`：共享背景、几何标记、武器、弹体及引擎绘制。
- `src/domain/editors/editor-types.ts`：编辑坐标、模式与悬停预览的纯数据类型。
- `src/domain/editors/lib/geometry.ts`：舰船与武器坐标、角度、距离及边界线段纯规则。
- `src/domain/editors/projectile-appearance.ts`：投影共享弹体外观、原点、纹理参数及引擎几何。
- `src/orchestrators/project-sync.orchestrator.ts`：窗口内保存消费过程和内容维护者交接。
- `src/services/entity-query.service.ts`：四类查询定义、正式请求与实体失效选择。
- `src/services/resource-media.service.ts`：唯一持有媒体读取、合批、租约、响应式结果、闲置预算和失效。
- `src/services/weapon-data.service.ts`：消费共享武器规格、CSV 与授权武器资源查询。
- `src/services/window.service.ts`：窗口 command 的类型化签名与参数装配。
- `src/shared/types/weapon-fire-preview.types.ts`：来源及只读查询结果交接模型。
- `src/stores/settings.store.ts`：settings 运行态，只持状态、setter 与派生值；初始快照经统一初始化入口注入。
- `src/windows/current.window.ts`：当前窗口生命周期，提供关闭请求、关闭监听、最小化、最大化、拖拽、重载与显示。
- `src/windows/managed.window.ts`：请求交付，等待所属请求的终结回执。
- `src/windows/window-context.window.ts`：只读上下文、请求监听接纳及上下文版本的前端运行态。

### 装配

- `src/app/WeaponFirePreviewApp.vue`：独立窗口根，消费唯一窗口壳。
- `src/app/composables/immersive-editor/weapon/use-immersive-weapon-editor.ts`：沉浸式武器草稿与弹体引用的预览来源交接。

## 边界

- 业务来源由打开动作交付，窗口 ViewModel 拥有已接纳来源与所属读取。
- 场景消费共享弹体与光束 renderer；媒体、解码及着色成品由正式资源运行态持有。
- 播放 ViewModel 拥有当前模拟状态、播放速度、开火状态及挂载视图。
- 窗口协议拥有请求版本与回执，业务 ViewModel 在来源交接后安排依赖读取。
- 预览查询交付接纳 session、武器 CSV、单个关联弹体、来源版本及按武器与弹体分组的授权资源。
- 领域模拟拥有状态转换与随机依赖，Canvas 调用归应用渲染层。

## 链路

### 打开与来源接纳

1. 武器列表以 saved 来源打开预览；Spec 武器编辑器与沉浸式武器编辑器以提交后的独立武器规格快照打开预览。
2. 窗口请求入口登记 weapon-fire-preview 身份及完整来源。
3. 预览窗口接纳最新来源，使较早读取失效。
4. 窗口 ViewModel 完成所属武器、CSV 及弹体读取，随后回执 accepted。
5. 所属展示登记媒体租约，消费共享解码及着色成品。
6. 窗口内容保持当前实例，播放 ViewModel 消费新参数并绘制。

### 模拟与绘制

1. 播放控件交付播放、暂停、开火、停火、倍速及挂载动作。
2. 播放 ViewModel 按运行状态调用帧循环，领域模型推进发射、弹体与光束状态。
3. 共享图像运行态交付当前可用贴图与着色结果。
4. 场景消费规格投影、当前模拟、资源、视口及配色，绘制当前画面。
5. 重置动作按当前参数建立新的模拟状态。

### 更新与释放

1. 统一提交管线接纳项目正式内容并失效依赖查询及资源。
2. 身份阶段交接预览身份与 draft 规格 ID，窗口 ViewModel 重读所属依赖。
3. 后台刷新接纳当前数据；读取失败进入所属反馈并保留已接纳内容。
4. 窗口释放请求监听、读取票据、图像资源和帧循环。

## 规范

- draft 来源必须由再次打开请求更新规格；CSV、弹体和资源经正式查询及统一失效管线更新。
- saved 与 draft 必须作为互斥来源完整交付，每次复用明确交接来源。
- 发射调度必须按事件时刻消费充能、连射、炮管及散布；光束 burst size 表达秒数，弹体表达次数。
- 回看必须保留最近 120 幅完整模拟状态并计入当前画面，最早画面的上一帧禁用；继续播放从当前位置重新推进并替换后续记录。
- 存活弹体必须持有出生时的定义，后续发射消费最新定义；视口变化只允许变换世界坐标。
- 导弹沿出生方向消费 CSV launch speed、proj speed、flight time 及所属熄火、尾迹和渐隐配置。
- 开火状态、挂载及规格改变必须以当前画面重新记录并保留弹体与进度；重置及目标交接建立新起点，卸载释放记录，历史出生定义沿现有媒体登记持有并随记录淘汰释放。
- 开火预览通过独立快照与只读查询运行，规格草稿、保存及编辑历史由编辑器维护。
- 暂停必须停止模拟帧循环并保留进度，字段、资源、主题与尺寸变化绘制当前状态。
- 来源与依赖更新必须保持预览组件实例、播放、开火、倍速、挂载视图及模拟进度；重置由显式动作执行。
- 武器辉光消费充能、连射、冷却及光束阶段的亮度，初始待机交付零亮度；暂停保留当前亮度。
- 画布消费共同导航及十字绘制，坐标以武器原点为零、向右和向上为正、按 0.5 间隔显示一位小数；离开画布隐藏十字并结束拖动。
- 窗口身份必须包含 session、Mod 根及武器 ID，身份交接共同映射 draft 规格 ID 与可重载上下文。
- 视口独立持有观看位置与相对缩放，范围为适应比例的 0.1 至 20 倍；手动视野在挂载切换、模拟重置及规格更新后保留，暂停交互只重绘当前模拟状态。
- 适应视图以武器原点左侧 80px、射程线右侧 60px 展示完整射程，按钮消费真实适应状态；实际平移或缩放取消适应，右键按下保留状态，适应期间尺寸与射程更新重新计算视野。
- 逐帧按钮同行呈现，点击暂停；上一帧恢复已记录状态，下一帧优先恢复后续记录，到达最新画面后推进 1/60 秒模拟时间并保持当前倍速。
- 零 alpha 必须跳过 glow 绘制及着色缓存，预览模拟帧循环由播放状态控制。
