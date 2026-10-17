<template>
  <div class="settings-page page-content page-slot ui-content-column ui-content-grid ui-content-surface-muted">
    <header class="settings-header page-header ui-control-between ui-layout-row ui-control-reset">
      <div class="page-identity ui-layout-grid ui-layout-shrink">
        <h1 class="page-title ui-text-reset ui-layout-shrink ui-text-wrap ui-text-normal">设置</h1>
      </div>
    </header>
    <section
      class="settings-section panel-card schema-form ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch"
    >
      <h3 class="settings-section-title panel-section-title ui-text-soft ui-text-reset ui-text-small">游戏目录</h3>
      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">Starsector 安装路径</span>
        <div class="settings-control-row ui-field-actions ui-field-control ui-control-row ui-layout-stretch">
          <n-input :value="settings.starsectorRoot ?? ''" size="small" placeholder="自动推断或手动指定" readonly />
          <n-button size="small" @click="pickStarsectorRoot">选择目录</n-button>
          <n-button v-if="settings.starsectorRoot" size="small" quaternary @click="settings.setStarsectorRoot(null)">清除</n-button>
        </div>
        <div
          v-if="settings.starsectorRoot"
          class="settings-hint ui-field-hint ui-text-description ui-text-wrap ui-control-reset ui-text-muted ui-text-small"
        >
          已设置: {{ settings.starsectorRoot }}
        </div>
        <div v-else class="settings-hint ui-field-hint ui-text-description ui-text-wrap ui-control-reset ui-text-muted ui-text-small">
          未设置时，工具将从导入的 Mod 路径自动推断（mod_root 的上两级目录）。
        </div>
      </div>
    </section>
    <section
      class="settings-section panel-card schema-form ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch"
    >
      <h3 class="settings-section-title panel-section-title ui-text-soft ui-text-reset ui-text-small">外观</h3>
      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">主题明暗</span>
        <n-switch class="tool-switch settings-theme-switch ui-field-control" :value="settings.isDark" @update:value="settings.toggleTheme">
          <template #checked>暗色</template>
          <template #unchecked>浅色</template>
        </n-switch>
      </div>
      <div class="settings-row ui-field-row settings-row-top ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label field-label-multi ui-text-soft">主题色</span>
        <div class="accent-settings color-picker-palette ui-field-control ui-field-control-top ui-layout-grid ui-layout-shrink">
          <div class="accent-swatch-grid color-picker-palette-options ui-layout-row ui-layout-center">
            <button
              v-for="preset in ACCENT_PRESETS"
              :key="preset.value"
              class="accent-swatch-button color-picker-palette-button ui-button ui-layout-grid ui-control-pointer ui-control-reset ui-control-border ui-content-surface"
              :class="{ active: settings.accent === preset.value }"
              type="button"
              :title="preset.name"
              @click="settings.setAccent(preset.value)"
            >
              <span
                class="accent-swatch-button-label color-picker-palette-swatch ui-control-border"
                :style="{ backgroundColor: preset.hex }"
              />
            </button>
            <div
              class="accent-custom-control color-picker-palette-custom ui-control-row ui-layout-grid ui-layout-center ui-control-border ui-content-surface"
              :class="{ active: settings.accent === 'custom' }"
            >
              <button
                class="accent-custom-label color-picker-palette-label ui-button ui-control-button ui-text-normal ui-control-reset ui-text-soft ui-text-small"
                type="button"
                @click="settings.setAccent('custom')"
              >
                自定义
              </button>
              <ColorPicker
                v-model="customAccentDraft"
                class="accent-custom-input color-picker-palette-input"
                channels="rgb"
                output="hex-rgb"
                :allow-text-input="true"
                @click="settings.setAccent('custom')"
                @update:model-value="applyCustomAccent"
              />
            </div>
          </div>
          <div
            v-if="!customAccentValid"
            class="settings-hint ui-field-hint settings-hint-error ui-text-description ui-text-wrap ui-control-reset ui-text-muted ui-text-small"
          >
            自定义主题色必须是 #RRGGBB。
          </div>
        </div>
      </div>
    </section>
    <section
      class="settings-section panel-card schema-form ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch"
    >
      <h3 class="settings-section-title panel-section-title ui-text-soft ui-text-reset ui-text-small">字体</h3>
      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">通用字体</span>
        <div class="settings-control-row ui-field-actions ui-field-control ui-control-row ui-layout-stretch">
          <n-select
            :value="settings.generalFont ?? ''"
            :options="fontOptions"
            :loading="fontsLoading"
            filterable
            size="small"
            @update:value="settings.setGeneralFont($event || null)"
          />
        </div>
        <div class="settings-hint ui-field-hint ui-text-description ui-text-wrap ui-control-reset ui-text-muted ui-text-small">
          选择本机已安装字体。默认字体组合为 Inter、Segoe UI、Microsoft YaHei。
        </div>
      </div>

      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">沉浸式编辑器字体</span>
        <n-switch class="tool-switch ui-field-control" :value="settings.immersiveGameFont" @update:value="settings.setImmersiveGameFont" />
        <div class="settings-hint ui-field-hint ui-text-description ui-text-wrap ui-control-reset ui-text-muted ui-text-small">
          从游戏安装目录加载原版字体。原版字体缺字时，以英文问号代替。
        </div>
      </div>
    </section>
    <section
      class="settings-section panel-card schema-form ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch"
    >
      <h3 class="settings-section-title panel-section-title ui-text-soft ui-text-reset ui-text-small">编辑模式</h3>
      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">引用式编辑</span>
        <n-radio-group :value="settings.editMode" class="settings-mode-group ui-field-control" @update:value="settings.setEditMode">
          <n-radio-button value="plain">纯文本</n-radio-button>
          <n-radio-button value="smart">增强控件</n-radio-button>
        </n-radio-group>
        <div class="settings-hint ui-field-hint ui-text-description ui-text-wrap ui-control-reset ui-text-muted ui-text-small">
          纯文本模式下，CSV 表格和其它引用型编辑入口都只使用文本编辑。增强控件模式下，将引入更直观的编辑界面。
        </div>
      </div>
    </section>
    <section
      class="settings-section panel-card schema-form ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch"
    >
      <h3 class="settings-section-title panel-section-title ui-text-soft ui-text-reset ui-text-small">全局限制</h3>
      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">文件保存历史步数</span>
        <n-input-number
          class="settings-number-input ui-field-number ui-field-control"
          :value="settings.fileHistoryLimit"
          :min="1"
          :max="MAX_HISTORY_LIMIT"
          :step="1"
          :precision="0"
          @update:value="settings.setFileHistoryLimit($event ?? settings.fileHistoryLimit)"
        />
        <div class="settings-hint ui-field-hint ui-text-description ui-text-wrap ui-control-reset ui-text-muted ui-text-small">
          每个 Mod 独立保留已保存文件的撤销历史。降低步数会立即裁剪较早的 undo 记录。
        </div>
      </div>

      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">编辑撤销步数</span>
        <n-input-number
          class="settings-number-input ui-field-number ui-field-control"
          :value="settings.editHistoryLimit"
          :min="1"
          :max="MAX_HISTORY_LIMIT"
          :step="1"
          :precision="0"
          @update:value="settings.setEditHistoryLimit($event ?? settings.editHistoryLimit)"
        />
        <div class="settings-hint ui-field-hint ui-text-description ui-text-wrap ui-control-reset ui-text-muted ui-text-small">
          各表格及编辑会话独立保留草稿撤销历史。降低步数会立即裁剪较早的 undo 记录。
        </div>
      </div>
    </section>
    <section
      class="settings-section panel-card schema-form ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch"
    >
      <h3 class="settings-section-title panel-section-title ui-text-soft ui-text-reset ui-text-small">JSON 保存</h3>
      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">原样保存</span>
        <n-switch
          class="tool-switch ui-field-control"
          :value="settings.preserveOriginalJson"
          @update:value="settings.setPreserveOriginalJson"
        />
        <div class="settings-hint ui-field-hint ui-text-description ui-text-wrap ui-control-reset ui-text-muted ui-text-small">
          尽量保留结构化 JSON 文件的注释与字段顺序。无法保留时会在写入前请求确认。
        </div>
      </div>
    </section>
    <section
      class="settings-section panel-card schema-form ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch"
    >
      <h3 class="settings-section-title panel-section-title ui-text-soft ui-text-reset ui-text-small">原版内容</h3>
      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">允许编辑原版</span>
        <n-switch class="tool-switch ui-field-control" :value="settings.allowCoreEditing" @update:value="settings.setAllowCoreEditing" />
        <div class="settings-hint ui-field-hint ui-text-description ui-text-wrap ui-control-reset ui-text-muted ui-text-small">
          允许写入 Starsector 原版内容。
        </div>
      </div>
    </section>
    <section
      class="settings-section panel-card schema-form ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch"
    >
      <h3 class="settings-section-title panel-section-title ui-text-soft ui-text-reset ui-text-small">配置文件</h3>
      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">日志输出目录</span>
        <div class="settings-control-row ui-field-actions ui-field-control ui-control-row ui-layout-stretch">
          <n-input :value="settings.logDirectory ?? '默认 app data'" size="small" readonly />
          <n-button size="small" @click="pickLogDirectory">选择目录</n-button>
          <n-button v-if="settings.logDirectory" size="small" quaternary @click="restoreDefaultLogDirectory">恢复默认</n-button>
        </div>
      </div>
      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">日志级别</span>
        <div class="settings-control-row ui-field-actions ui-field-control ui-control-row ui-layout-stretch">
          <n-select :value="settings.logLevel" :options="LOG_LEVEL_OPTIONS" size="small" @update:value="updateLogLevel" />
        </div>
      </div>
      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">日志轮转大小（MiB）</span>
        <n-input-number
          class="settings-number-input ui-field-number ui-field-control"
          :value="settings.logRotationSizeMiB"
          :min="1"
          :max="MAX_LOG_ROTATION_SIZE_MIB"
          :step="1"
          :precision="0"
          @update:value="settings.setLogRotationSizeMiB($event ?? settings.logRotationSizeMiB)"
        />
        <div class="settings-hint ui-field-hint ui-text-description ui-text-wrap ui-control-reset ui-text-muted ui-text-small">
          当前日志达到该大小时，在下一次追加前轮转。
        </div>
      </div>

      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">日志备份份数</span>
        <n-input-number
          class="settings-number-input ui-field-number ui-field-control"
          :value="settings.logBackupCount"
          :min="1"
          :max="MAX_LOG_BACKUP_COUNT"
          :step="1"
          :precision="0"
          @update:value="settings.setLogBackupCount($event ?? settings.logBackupCount)"
        />
        <div class="settings-hint ui-field-hint ui-text-description ui-text-wrap ui-control-reset ui-text-muted ui-text-small">
          保留最近的已轮转日志。降低份数在下次轮转时整理已有备份。
        </div>
      </div>

      <div class="settings-row ui-field-row ui-control-row ui-layout-grid ui-layout-shrink ui-text-small">
        <span class="settings-row-label ui-field-label ui-text-soft">Log 文件大小</span>
        <strong class="ui-field-control ui-emphasis">{{ formattedLogSize }}</strong>
      </div>
      <div class="settings-control-row ui-field-actions settings-file-actions ui-control-row">
        <n-button size="small" @click="openConfigFolderAction">打开配置文件夹</n-button>
        <n-button size="small" @click="openLogFileAction">打开 log 文件</n-button>
        <n-button size="small" type="error" secondary @click="confirmClearConfig">清空配置文件</n-button>
        <n-button size="small" type="error" secondary @click="confirmClearLog">清除 log 文件</n-button>
      </div>
      <div class="settings-hint ui-field-hint ui-text-description ui-text-wrap ui-control-reset ui-text-muted ui-text-small">
        {{ logPathHint }}
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import type { JsonValue, LogLevel } from '@/shared/types';
import { useSettingsStore } from '@/stores/settings.store';
import { MAX_HISTORY_LIMIT, MAX_LOG_ROTATION_SIZE_MIB, MAX_LOG_BACKUP_COUNT } from '@/domain/settings/rules';
import { ACCENT_PRESETS } from '@/domain/settings/theme';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import { useSettingsViewModel } from '@/app/composables/settings/use-settings-view-model';

const LOG_LEVEL_OPTIONS: { label: string; value: LogLevel }[] = [
  { label: '默认（INFO）', value: 'info' },
  { label: '详细（DEBUG）', value: 'debug' },
];

function updateLogLevel(value: string) {
  const level = LOG_LEVEL_OPTIONS.find((option) => option.value === value);
  if (level) settings.setLogLevel(level.value);
}

const settings = useSettingsStore();
const props = defineProps<{ closeWorkspace: () => Promise<boolean> }>();
const customAccentDraft = ref(settings.customAccent);
const customAccentValid = ref(true);
const {
  fontOptions,
  fontsLoading,
  loadSystemFonts,
  formattedLogSize,
  logPathHint,
  pickLogDirectory,
  pickStarsectorRoot,
  refreshLogStatus,
  openConfigFolderAction,
  openLogFileAction,
  restoreDefaultLogDirectory,
  confirmClearConfig,
  confirmClearLog,
} = useSettingsViewModel(props.closeWorkspace);

onMounted(() => {
  void loadSystemFonts();
  void refreshLogStatus();
});

watch(
  () => settings.customAccent,
  (value) => {
    customAccentDraft.value = value;
    customAccentValid.value = true;
  },
);

function applyCustomAccent(value: JsonValue | number[] = customAccentDraft.value) {
  if (typeof value !== 'string') return;
  customAccentDraft.value = value;
  const applied = settings.setCustomAccent(value);
  customAccentValid.value = applied;
}
</script>
