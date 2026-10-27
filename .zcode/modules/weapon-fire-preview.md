# 武器开火预览

## 定义

武器开火预览模块提供独立窗口中的只读武器发射模拟与播放控制。

## 参考

### 拥有

- `src/app/WeaponFirePreviewContent.vue`：加载状态、稳定预览实例与关闭动作的装配入口。
- `src/app/components/weapon-fire-preview/`：开火预览控制、画布与行为测试。
- `src/app/components/weapon-fire-preview/WeaponFirePreview.vue`：预览控件与画布事件绑定组件。
- `src/app/composables/weapon-fire-preview/`：预览来源、读取、播放与模拟生命周期。
- `src/app/composables/weapon-fire-preview/use-weapon-fire-preview-view-model.ts`：播放、开火、挂载视图、速度、模拟推进与渲染装配。
- `src/app/composables/weapon-fire-preview/use-weapon-fire-preview-window-view-model.ts`：来源、读取票据、依赖刷新、身份及错误接纳。
- `src/app/renderers/weapon-fire-preview/`：开火预览静态贴图和模拟阶段绘制。
- `src/app/renderers/weapon-fire-preview/scene.ts`：预览场景及最终绘制样式，消费共享武器贴图绘制。
- `src/domain/weapon-fire-preview/`：开火时序、弹体、光束及模拟参数规则。
- `src/domain/weapon-fire-preview/simulation.ts`：必须维护世界坐标、出生定义、光束、弹体、尾迹与寿命阶段。
- `src/orchestrators/weapon-fire-preview.orchestrator.ts`：预览原生身份、标题与窗口上下文交接。
- `src/services/weapon-fire-preview.service.ts`：武器来源及完整弹体只读装配、依赖错误。
- `src/windows/weapon-fire-preview.window.ts`：完整预览身份、来源、标题与尺寸的请求入口。

### 消费

- `src/app/components/editors/common/EditorFooter.vue`：编辑与预览共用的说明及操作插槽。
- `src/app/components/editors/common/EditorHeader.vue`：编辑与预览共用的标题、dirty、外部基线及动作插槽。
- `src/app/components/editors/common/EditorInspector.vue`：编辑与预览共用的属性区标题及独立滚动容器。
- `src/app/composables/canvas/use-canvas-navigation.ts`：预览消费右键平移与鼠标锚点缩放。
- `src/app/composables/canvas/use-canvas-viewport.ts`：预览消费缩放、平移、适应状态及画布尺寸。
- `src/app/renderers/editors/canvas-scene.ts`：预览消费共同网格、鼠标十字及坐标绘制。
- `src/services/weapon-data.service.ts`：消费共享武器规格、CSV 与授权武器资源查询。
- `src/shared/types/weapon-fire-preview.types.ts`：来源及只读查询结果交接模型。

### 装配

- `src/app/WeaponFirePreviewApp.vue`：独立窗口根，消费唯一窗口壳。
- `src/app/composables/immersive-editor/weapon/use-immersive-weapon-editor.ts`：沉浸式武器草稿与弹体引用的预览来源交接。

## 边界

- 业务来源由打开动作交付，窗口 ViewModel 拥有已接纳来源与所属读取。
- 场景必须消费共享弹体与光束 renderer；媒体、解码及着色成品必须由正式资源运行态持有。
- 播放 ViewModel 拥有当前模拟状态、播放速度、开火状态及挂载视图。
- 窗口协议拥有请求版本与回执，业务 ViewModel 在来源交接后安排依赖读取。
- 预览查询必须交付接纳 session、武器 CSV、单个关联弹体、来源版本及按武器与弹体分组的授权资源。
- 领域模拟拥有状态转换与随机依赖，Canvas 调用归应用渲染层。

## 链路

### 打开与来源接纳

1. 武器列表以 saved 来源打开预览；Spec 武器编辑器与沉浸式武器编辑器以提交后的独立武器规格快照打开预览。
2. 窗口请求入口登记 weapon-fire-preview 身份及完整来源。
3. 预览窗口接纳最新来源，使较早读取失效。
4. 窗口 ViewModel 完成所属武器、CSV 及弹体读取，随后回执 accepted。
5. 所属展示必须登记媒体租约，消费共享解码及着色成品。
6. 窗口内容保持当前实例，播放 ViewModel 消费新参数并绘制。

### 模拟与绘制

1. 播放控件交付播放、暂停、开火、停火、倍速及挂载动作。
2. 播放 ViewModel 按运行状态调用帧循环，领域模型推进发射、弹体与光束状态。
3. 共享图像运行态交付当前可用贴图与着色结果。
4. 场景消费规格投影、当前模拟、资源、视口及配色，绘制当前画面。
5. 重置动作按当前参数建立新的模拟状态。

### 更新与释放

1. 统一提交管线接纳项目投影并失效依赖查询及资源。
2. 身份阶段交接预览身份与 draft 规格 ID，窗口 ViewModel 重读所属依赖。
3. 后台刷新接纳当前数据；读取失败进入所属反馈并保留已接纳内容。
4. 窗口释放请求监听、读取票据、图像资源和帧循环。

## 规范

- draft 来源必须由再次打开请求更新规格；CSV、弹体和资源必须经正式查询及统一失效管线更新。
- saved 与 draft 必须作为互斥来源完整交付，每次复用必须明确交接来源。
- 业务接纳必须等待正式数据，展示贴图必须沿独立读取生命周期交付。
- 初次读取失败必须在内容区呈现，后台失败必须保留已接纳内容并交付一次反馈。
- 发射调度必须按事件时刻消费充能、连射、炮管及散布；光束 burst size 必须表达秒数，弹体必须表达次数。
- 回看必须保留最近 120 幅完整模拟状态并计入当前画面，最早画面的上一帧必须禁用；继续播放必须从当前位置重新推进并替换后续记录。
- 存活弹体必须持有出生时的定义，后续发射必须消费最新定义；视口变化只允许变换世界坐标。
- 导弹必须沿出生方向消费 CSV launch speed、proj speed、flight time 及所属熄火、尾迹和渐隐配置。
- 开火状态、挂载及规格改变必须以当前画面重新记录并保留弹体与进度；重置及目标交接必须建立新起点，卸载必须释放记录，历史出生定义必须沿现有媒体登记持有并随记录淘汰释放。
- 开火预览只允许消费独立快照与只读查询，严禁拥有规格草稿、保存及编辑历史。
- 弹体引用缺失必须交付所属查询错误。
- 暂停必须停止模拟帧循环并保留进度，字段、资源、主题与尺寸变化必须绘制当前状态。
- 来源与依赖更新必须保持预览组件实例、播放、开火、倍速、挂载视图及模拟进度；重置必须由显式动作执行。
- 武器辉光必须消费充能、连射、冷却及光束阶段的亮度，初始待机必须交付零亮度；暂停必须保留当前亮度。
- 画布必须消费共同导航及十字绘制，坐标必须以武器原点为零、向右和向上为正、按 0.5 间隔显示一位小数；离开画布必须隐藏十字并结束拖动。
- 界面刷新必须由所属根登记实际来源与动作，并沿现有保存等待、草稿和外部更新接纳流程执行。
- 窗口身份必须包含 session、Mod 根及武器 ID，身份交接必须共同映射 draft 规格 ID 与可重载上下文。
- 视口必须独立持有观看位置与相对缩放，范围必须为适应比例的 0.1 至 20 倍；手动视野必须在挂载切换、模拟重置及规格更新后保留，暂停交互必须只重绘当前模拟状态。
- 请求、身份和释放必须结束较早读取的接纳权，迟到值与错误严禁覆盖当前内容。
- 适应视图必须以武器原点左侧 80px、射程线右侧 60px 展示完整射程，按钮必须消费真实适应状态；实际平移或缩放必须取消适应，右键按下必须保留状态，适应期间尺寸与射程更新必须重新计算视野。
- 逐帧按钮必须同行呈现，点击必须暂停；上一帧必须恢复已记录状态，下一帧必须优先恢复后续记录，到达最新画面后必须推进 1/60 秒模拟时间并保持当前倍速。
- 零 alpha 必须跳过 glow 绘制及着色缓存，预览模拟帧循环必须由播放状态控制。
