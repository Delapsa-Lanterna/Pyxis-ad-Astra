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
- `src/domain/weapon-fire-preview/simulation.ts`：规格投影、发射计时、弹体和光束阶段的纯模型。
- `src/orchestrators/weapon-fire-preview.orchestrator.ts`：预览原生身份、标题与窗口上下文交接。
- `src/services/weapon-fire-preview.service.ts`：武器来源及完整弹体只读装配、依赖错误。
- `src/windows/weapon-fire-preview.window.ts`：完整预览身份、来源、标题与尺寸的请求入口。

### 消费

- `src/app/components/editors/common/EditorFooter.vue`：编辑与预览共用的说明及操作插槽。
- `src/app/components/editors/common/EditorHeader.vue`：编辑与预览共用的标题、dirty、外部基线及动作插槽。
- `src/app/components/editors/common/EditorInspector.vue`：编辑与预览共用的属性区标题及独立滚动容器。
- `src/services/weapon-data.service.ts`：消费共享武器规格、CSV 与授权武器资源查询。
- `src/shared/types/weapon-fire-preview.types.ts`：来源及只读查询结果交接模型。

### 装配

- `src/app/WeaponFirePreviewApp.vue`：独立窗口根，消费唯一窗口壳。

## 边界

- 业务来源由打开动作交付，窗口 ViewModel 拥有已接纳来源与所属读取。
- 场景拥有视觉规则，共享图像运行态与帧循环拥有加载、缓存和释放。
- 播放 ViewModel 拥有当前模拟状态、播放速度、开火状态及挂载视图。
- 窗口协议拥有请求版本与回执，业务 ViewModel 在来源交接后安排依赖读取。
- 预览查询入口消费共享武器规格、CSV 与资源，按当前来源的 projectileSpecId 读取完整弹体并交付只读结果。
- 领域模拟拥有状态转换与随机依赖，Canvas 调用归应用渲染层。

## 链路

### 打开与来源接纳

1. 武器列表以 saved 来源打开预览；武器编辑器以提交后的独立草稿快照打开预览。
2. 窗口请求入口登记 weapon-fire-preview 身份及完整来源。
3. 预览窗口接纳最新来源，使较早读取失效。
4. 窗口 ViewModel 完成所属武器、CSV 及弹体读取，随后回执 accepted。
5. 所属展示读取独立加载授权贴图并更新当前预览数据。
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
- 初次读取失败必须在内容区呈现，后台失败必须保留已接纳内容并交付一次反馈。
- 开火预览只允许消费独立快照与只读查询，严禁拥有规格草稿、保存及编辑历史。
- 暂停必须停止模拟帧循环并保留进度，字段、资源、主题与尺寸变化必须绘制当前状态。
- 来源与依赖更新必须保持预览组件实例、播放、开火、倍速、挂载视图及模拟进度；重置必须由显式动作执行。
- 界面刷新必须由所属根登记实际来源与动作，并沿现有保存等待、草稿和外部更新接纳流程执行。
- 窗口身份必须包含 session、Mod 根及武器 ID，身份交接必须共同映射 draft 规格 ID 与可重载上下文。
- 请求、身份和释放必须结束较早读取的接纳权，迟到值与错误严禁覆盖当前内容。
- 零 alpha 必须跳过 glow 绘制及着色缓存，预览模拟帧循环必须由播放状态控制。

## 陷阱

- 业务接纳必须等待正式数据，展示贴图必须沿独立读取生命周期交付。
- 在缺失弹体时构造默认规格会掩盖所属引用错误。
- 把参数刷新作为模拟重置会改变暂停进度和开火阶段。
- 让预览消费编辑器实时可变草稿会破坏独立来源寿命。
