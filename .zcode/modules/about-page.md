# 关于页面

## 定义

关于页面是主窗口只读信息页，展示静态元信息与构建时内联的更新记录。

## 参考

### 拥有

- `CHANGELOG.md`：关于页面构建时消费的发布说明。
- `src/app/components/AboutPage.vue`：页面组件，拥有静态元信息模板与 Markdown 渲染。

### 消费

- `src/shared/ui/FieldRow.vue`：只读信息字段的共同展示入口。

### 装配

- `src/app/AppContent.vue`：挂载入口，按当前视图挂载关于页面。
- `src/app/TitleBar.vue`：标题栏入口，触发 `showAbout` 导航。

### 关联

- `src/stores/workspace.store.ts`：视图状态，只持有 `currentView='about'`。

## 边界

- 关于页的输入是构建时内联的 `CHANGELOG.md`，Markdown 渲染归页面组件。
- 启动恢复归工作区编排，恢复完成后的视图为 overview。
- 视图状态归 workspace store，标题栏和导航编排消费其切换入口。
- 静态元信息必须由页面模板维护，信息字段必须消费共同字段行，更新正文必须消费富文本内容入口。
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

- Markdown 渲染必须消费构建时内联内容，并必须保留语义节点。
- changelog 必须由构建入口内联，版本元信息必须由页面的静态模型提供。
- 信息字段必须显式提供名称，正文渲染必须保留内联内容的语义节点。
- 启动恢复完成后的视图必须为工作区总览。
- 渲染输入仅限仓库内联 changelog，严禁接收运行时字符串进入 `v-html`。
- 页面必须保持只读：无编辑控件、无保存、无日志与 IPC 调用。
- 页面路由必须经 workspace 视图状态，严禁引入独立路由记录。
