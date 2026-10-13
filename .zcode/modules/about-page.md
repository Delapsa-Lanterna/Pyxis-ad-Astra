# 关于页面

## 定义

关于页面是主窗口只读信息页，展示静态元信息与构建时内联的更新记录。

## 参考

`src/app/AppContent.vue`：挂载入口，按当前视图挂载关于页面。
`src/app/TitleBar.vue`：标题栏入口，触发 `showAbout` 导航。
`src/app/components/AboutPage.vue`：页面组件 owner，拥有静态元信息模板与 Markdown 渲染。
`src/stores/workspace.store.ts`：视图状态 owner，只持有 `currentView='about'`。

## 边界

- 关于页的输入是构建时内联的 `CHANGELOG.md`，Markdown 渲染归页面组件。
- 启动恢复归工作区编排，恢复完成后的视图为 overview。
- 视图状态归 workspace store，标题栏和导航编排消费其切换入口。
- 静态元信息归组件模板，页面骨架复用设置页，内容样式限定在 `.about-content`。
- 页面提供静态信息展示，`v-html` 的内容来源限定为仓库 changelog。

## 链路

### 打开关于页

1. 用户在标题栏菜单点击关于入口。
2. 标题栏调用导航动作，等待保存与草稿确认后接纳 `workspace.showAbout`。
3. AppContent 按 `currentView='about'` 挂载关于页面。
4. 组件以 marked 渲染构建时内联的 changelog。

### 离开关于页

1. 用户导航到其它全局页或 Mod 页。
2. workspace 切换 `currentView`，关于页卸载。

## 规范

- Markdown 样式必须限定作用域，严禁污染全局排版。
- changelog 必须由构建入口内联，版本元信息必须由页面的静态模型提供。
- 渲染输入仅限仓库内联 changelog，严禁接收运行时字符串进入 `v-html`。
- 页面必须保持只读：无编辑控件、无保存、无日志与 IPC 调用。
- 页面路由必须经 workspace 视图状态，严禁引入独立路由记录。

## 陷阱

- 在组件内运行时读取 changelog 文件会让构建产物依赖磁盘布局。
- 把关于页加入启动恢复会让工具无法回到工作区总览。
- 让关于页渲染运行时或用户文本会让 `v-html` 成为注入面。
