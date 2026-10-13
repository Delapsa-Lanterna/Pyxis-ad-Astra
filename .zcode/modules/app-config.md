# 工具配置维护

## 定义

工具配置维护模块提供工具私有目录的打开和配置清理能力。

## 参考

`src-tauri/src/commands/app_config.rs`：配置维护 command。
`src-tauri/src/services/app_config.rs`：实际工具配置清理范围。
`src-tauri/src/services/app_paths.rs`：工具 app-data 根解析主归属。
`src/app/composables/settings/use-app-config-actions.ts`：维护动作、危险确认和完成接纳主归属。
`src/app/composables/settings/use-settings-view-model.ts`：设置页消费配置动作并刷新日志投影。
`src/services/app-config.service.ts`：配置目录与清理 command 装配。

## 边界

- 工具私有根由 app_paths 解析，后端配置能力拥有实际清理范围与执行结果。
- 打开目录归系统能力，设置页动作消费返回的工具目录。
- 清理确认、错误呈现与成功重载归配置维护动作 composable。
- 设置页 ViewModel 消费维护动作，并接纳完成后的日志投影。
- 配置清理作用于 app-data；日志维护由应用日志能力提供。

## 链路

### 打开目录

1. 设置页发起打开动作。
2. 能力调用 `open_config_dir`。
3. Rust 解析并建立工具目录，调用所属系统打开能力。

### 清理配置

1. 设置页提交危险确认。
2. 能力调用 `clear_config_files`。
3. Rust 枚举工具根内容，保留正式日志文件并清理其余文件与子目录。
4. 动作成功后刷新日志状态并重载窗口。

## 规范

- 打开目录必须通过系统能力，严禁前端拼接 app-data 路径。
- 正式 LOG_FILE 必须保留，工具目录缺失必须按空清理结果完成。
- 清理严禁触及 Mod、Core 或用户指定的外部日志目录。
- 清理失败必须保留原始诊断并呈现一次错误，重载必须在成功后执行。
- 清理范围必须包括工具根内 settings、workspace 及派生工具子目录，确认必须表达该实际范围。

## 陷阱

- 从组件枚举或删除配置文件会让工具根授权与实际清理范围脱离后端能力。
- 将工具清理当作 Mod 保存会混淆私有配置与业务文件的持久化范围。
- 清理失败后重载窗口会使错误反馈与磁盘结果失去对应。
