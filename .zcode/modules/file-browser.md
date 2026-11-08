# 文件浏览器

## 定义

文件浏览器模块提供已加载项目的目录浏览及文本文件打开交接。

## 参考

### 拥有

- `src-tauri/src/commands/file_browser.rs`：目录与文本目标查询的 IPC 装配。
- `src-tauri/src/services/project/query/file_browser.rs`：会话根目录读取、受限条目识别与内容判定。
- `src/app/components/file-browser/`：受控文件树、元数据列与工具栏及其测试。
- `src/app/components/file-browser/FileBrowser.vue`：受控文件树、虚拟滚动、焦点及节点反馈展示。
- `src/app/composables/file-browser/`：目录读取、预载、搜索和文本打开生命周期。
- `src/app/composables/file-browser/use-directory-reads.ts`：目录读取优先队列、在途合并、并发及票据接纳。
- `src/app/composables/file-browser/use-file-browser-view-model.ts`：刷新、显示后预载、选择、键盘导航与打开动作。
- `src/domain/file-browser/`：文件树、同级排序与元数据展示纯投影。
- `src/domain/file-browser/file-tree.ts`：元数据展示、同级排序、普通与搜索树、可见节点及目录影响的纯投影。
- `src/services/file-browser.service.ts`：目录、搜索及文本目标的类型化传输入口。
- `src/stores/file-browser.store.ts`：按 session 隔离的目录、搜索、排序及两组浏览状态。

### 消费

- `src-tauri/src/models/file_browser.rs`：目录条目、种类与文本窗口目标的 wire 模型。
- `src-tauri/src/services/project/session/access.rs`：捕获引用快照后锁定并交付所属就绪会话。
- `src-tauri/src/services/project/session/registry.rs`：会话存活登记、句柄与内容就绪门控。
- `src/app/composables/use-app-feedback.ts`：窗口反馈的提供与消费入口。
- `src/app/composables/use-context-menu.ts`：窗口菜单状态、目标操作、事件生命周期与业务根登记。
- `src/app/composables/use-window-shortcuts.ts`：统一窗口按键监听、菜单优先、关闭屏蔽及卸载释放。
- `src/orchestrators/project-sync.orchestrator.ts`：窗口内保存消费过程和内容维护者交接。
- `src/shared/types/file-browser.types.ts`：前端条目与浏览状态交接模型。
- `src/windows/file-editor.window.ts`：浏览动作消费的文本窗口创建与复用入口。

### 装配

- `src-tauri/src/services/mod.rs`：直接从所属实现交付正式业务函数入口。
- `src/app/AppContent.vue`：交付工作区当前正式浏览目标。

## 边界

- ProjectSession 提供授权根，目录查询拥有实际条目及文本内容判定。
- ViewModel 拥有读取接纳与用户动作，组件绑定展示、滚动及焦点。
- store 拥有本次运行的浏览状态，工作区拥有页面及项目身份。
- 文本窗口拥有文本、dirty、历史、保存和身份交接，浏览器交付正式打开目标。
- 普通浏览与搜索结果分别拥有展开、选择和滚动，搜索文本及排序归所属 session 运行态。
- 项目同步交付提供正式路径与所属投影，浏览运行态统一消费相关目录变化。
- 领域投影提供窗口范围的格式化、同级排序及节点复用，目录队列拥有读取调度，读取票据归共享运行态。

## 链路

### 浏览与刷新

1. 工作区导航交接活动输入和保存，宿主向文件概览页显式交付当前正式目标。
2. ViewModel 按 session 建立浏览状态，读取根目录。
3. 展开动作即时投影所属缓存并交付前台重读，领域投影交付根及展开分支。
4. 页面进入及刷新按父子顺序读取已展开目录，接纳条目并保留有效状态。
5. 显示后的下一帧交付直接子目录预载，读取队列接纳所属缓存。
6. 正式变化路径经所属运行态统一计算受影响目录，触发已加载目录或当前搜索重读。

### 全目录搜索

1. 工具栏输入进入所属搜索原文，防抖或 Enter 交付捕获查询。
2. 后端按会话授权递归读取文件名、元数据与祖先条目。
3. ViewModel 经读取票据接纳匹配树，新查询展开到匹配项，同查询刷新保留有效浏览状态。
4. 清空搜索恢复所属普通浏览，提交失效刷新当前查询。

### 文本打开

1. 双击或 Enter 捕获当前 session 及所属条目。
2. 正式查询核对会话根与相对路径，并按文件内容判定。
3. 文本结果交付完整窗口目标，窗口协议创建或复用所属文本窗口。
4. 编码错误经现有反馈呈现，明确选择源编码的转码动作进入所属写入管线。

### 释放

1. 页面离开或 session 替换结束读取与打开判定的接纳权。
2. 卸载解除所属结果登记，保留本次运行的有效浏览状态。
3. Mod 移除清理所属 session 浏览状态并完成工作区释放。

## 规范

- 二进制结果必须结束打开动作；未命中二进制特征的解码失败保留实际路径及 text.invalid_utf8 诊断。
- 同一次项目变化必须只计算一次受影响目录集合，每个已加载目录及当前搜索各自最多读取一次。
- 展开、选择和滚动必须按 session 隔离并保存在本次运行的内存中，项目释放时清理所属状态。
- 排序必须在各层同级条目内执行并保持目录优先，相等值消费名称自然排序，缺失值置于所属分组末尾。
- 搜索必须按名称进行忽略大小写的子串匹配并返回匹配项与祖先，递归只允许遍历所属授权根。
- 搜索输入必须按 250 ms 防抖或 Enter 立即提交，较早查询失效；清空搜索恢复普通浏览状态。
- 文件打开必须消费后端返回的完整 session、Mod 根及 path，严禁依据活动目录补齐已捕获目标。
- 查询必须消费已登记 session 的根与现有路径边界；链接和重解析点作为受限条目展示。
- 目录接纳必须清理消失条目的选择、展开及子目录结果，并结束所属在途读取。
- 目录查询只允许读取直接子项，内容判定只允许在文件打开动作执行。
- 目录缓存必须先于重读结果展示；未变化的条目、列表及显示节点保留所属引用，普通树只允许投影根与展开分支。
- 目录读取必须按 session 与相对目录合并在途请求，点击优先于待执行预载；实际请求并发至多为 3，其中预载至多为 2。
- 节点失败必须保留已接纳内容并提供重试；刷新保留仍有效的浏览状态。
- 预载只允许读取已显示目录的直接子目录，预载接纳严禁递归触发下一层读取；页面离开、搜索切换及 session 替换必须结束所属调度与接纳。
