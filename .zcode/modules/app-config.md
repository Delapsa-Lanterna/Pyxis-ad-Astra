# 工具配置维护

## 定义

工具配置维护模块提供工具私有目录创建与系统打开能力。

## 参考

### 拥有

- `src-tauri/src/commands/app_config.rs`：配置维护 command。
- `src-tauri/src/services/app_config.rs`：工具目录创建与系统打开交接。
- `src/app/composables/settings/use-app-config-actions.ts`：目录打开动作与错误反馈。
- `src/services/app-config.service.ts`：配置目录打开 command 装配。

### 消费

- `src-tauri/src/app_data_dir.rs`：工具私有数据目录的公共解析能力。
- `src-tauri/src/services/system_open.rs`：系统文件管理器路径打开适配。
- `src/app/components/SettingsPage.vue`：设置页面的目录打开入口。
- `src/app/composables/settings/use-settings-view-model.ts`：设置页消费配置维护动作。

## 边界

- 工具私有目录由 app_data_dir 的 data_directory 解析，后端配置能力拥有目录创建与打开结果。
- 打开目录动作归配置维护 composable，所属窗口承载失败反馈。
- 系统打开适配拥有操作系统文件管理器调用。
- 设置持久化与默认值重置归设置能力。
- 设置页 ViewModel 消费配置目录打开动作。

## 链路

### 打开目录

1. 设置页发起打开动作。
2. 能力调用 `open_config_dir`。
3. Rust 解析并建立工具目录，调用所属系统打开能力。

## 规范

- 工具数据目录必须消费 app_data_dir 的 data_directory 解析。
- 打开失败必须保留原始诊断并由所属窗口呈现一次错误。
- 打开目录必须先创建缺失目录，再调用系统打开能力。
- 目录打开必须返回所属系统能力的实际执行结果。
- 设置页必须通过配置维护动作发起目录打开。
