<template>
  <div class="page-content">
    <header class="page-header">
      <div class="page-identity">
        <h1 class="page-title">设置</h1>
        <p class="page-description">配置游戏目录、界面外观与编辑偏好。</p>
      </div>
    </header>
    <section class="panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
      <h3 class="panel-section-title">游戏目录</h3>
      <FieldRow label="Starsector 安装路径"
        ><div class="ui-field-actions ui-layout-stretch action-group">
          <n-input :value="settings.starsectorRoot ?? ''" size="small" placeholder="自动推断或手动指定" readonly />
          <n-button size="small" @click="pickStarsectorRoot">选择目录</n-button>
          <n-button v-if="settings.starsectorRoot" size="small" quaternary @click="changeStarsectorRoot(null)">清除</n-button>
        </div>
        <template #hint>
          <FieldHints
            :description="
              settings.starsectorRoot
                ? '已设置: ' + settings.starsectorRoot
                : '未设置时使用工作区游戏目录，孤立 Mod 则从其位置推断。指定目录覆盖全部 Mod 的原版来源，切换时会重新打开已加载 Mod。'
            "
          /> </template
      ></FieldRow>
    </section>
    <section class="panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
      <h3 class="panel-section-title">外观</h3>
      <FieldRow label="主题明暗"
        ><n-switch class="tool-switch" :value="settings.isDark" @update:value="settings.toggleTheme">
          <template #checked>暗色</template>
          <template #unchecked>浅色</template>
        </n-switch></FieldRow
      >
      <FieldRow label="主题色"
        ><div class="color-picker-palette ui-layout-grid ui-layout-shrink">
          <div class="color-picker-palette-options ui-layout-row ui-layout-center">
            <button
              v-for="preset in ACCENT_PRESETS"
              :key="preset.value"
              class="color-picker-palette-button ui-button ui-layout-grid ui-control-pointer ui-control-reset ui-control-border ui-content-surface"
              :class="{ active: settings.accent === preset.value }"
              type="button"
              :title="preset.name"
              @click="settings.setAccent(preset.value)"
            >
              <span class="color-picker-palette-swatch ui-control-border" :style="{ backgroundColor: preset.hex }" />
            </button>
            <div
              class="color-picker-palette-custom ui-control-row ui-layout-grid ui-layout-center ui-control-border ui-content-surface"
              :class="{ active: settings.accent === 'custom' }"
            >
              <button
                class="color-picker-palette-label ui-button ui-control-button ui-text-normal ui-control-reset ui-text-soft ui-text-small"
                type="button"
                @click="settings.setAccent('custom')"
              >
                自定义
              </button>
              <ColorPicker
                :model-value="customAccentDraft"
                class="color-picker-palette-input"
                channels="rgb"
                output="hex-rgb"
                :allow-text-input="true"
                @click="settings.setAccent('custom')"
                @update:model-value="applyCustomAccent"
              />
            </div>
          </div>
          <FieldHints v-if="!customAccentValid" description="自定义主题色必须是 #RRGGBB。" /></div
      ></FieldRow>
    </section>
    <section class="panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
      <h3 class="panel-section-title">字体</h3>
      <FieldRow label="通用字体"
        ><div class="ui-field-actions ui-layout-stretch action-group">
          <n-select
            :value="settings.generalFont ?? ''"
            :options="fontOptions"
            :loading="fontsLoading"
            filterable
            size="small"
            @update:value="settings.setGeneralFont($event || null)"
          />
        </div>
        <template #hint><FieldHints description="选择本机已安装字体。默认字体组合为 Inter、Segoe UI、Microsoft YaHei。" /></template
      ></FieldRow>

      <FieldRow label="沉浸式编辑器字体"
        ><n-switch class="tool-switch" :value="settings.immersiveGameFont" @update:value="settings.setImmersiveGameFont" /><template #hint
          ><FieldHints
            description="优先从指定目录加载字体，再尝试游戏原版字体，最后使用通用字体。位图字体缺字时，以英文问号代替。" /></template
      ></FieldRow>
      <FieldRow label="沉浸式字体路径">
        <div class="ui-field-actions ui-layout-stretch action-group">
          <n-input :value="settings.immersiveFontDirectory ?? ''" size="small" placeholder="使用游戏原版字体目录" readonly />
          <n-button size="small" @click="pickImmersiveFontDirectory">选择目录</n-button>
          <n-button v-if="settings.immersiveFontDirectory" size="small" quaternary @click="settings.setImmersiveFontDirectory(null)"
            >清除</n-button
          >
        </div>
        <template #hint><FieldHints description="选择直接存放游戏同名 .fnt 文件及配套图片的目录。" /></template>
      </FieldRow>
    </section>
    <section class="panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
      <h3 class="panel-section-title">编辑</h3>
      <FieldRow label="引用式编辑"
        ><n-switch
          class="tool-switch"
          :value="settings.editMode === 'smart'"
          @update:value="settings.setEditMode($event ? 'smart' : 'plain')"
        >
          <template #checked>增强控件</template>
          <template #unchecked>纯文本</template> </n-switch
        ><template #hint
          ><FieldHints
            description="纯文本模式下，CSV 表格和其它引用型编辑入口都只使用文本编辑。增强控件模式下，将引入更直观的编辑界面。" /></template
      ></FieldRow>
      <FieldRow label="展开字段解析">
        <n-switch class="tool-switch" :value="settings.expandFieldDescriptions" @update:value="settings.setExpandFieldDescriptions" />
        <template #hint>
          <FieldHints description="完全展开解析，关闭时字段解析将收入悬浮框。" />
        </template>
      </FieldRow>
      <FieldRow label="允许编辑原版">
        <n-switch class="tool-switch" :value="settings.allowCoreEditing" @update:value="settings.setAllowCoreEditing" />
        <template #hint>
          <FieldHints description="允许写入 Starsector 原版内容。" warning="修改原版文件可能影响游戏运行，操作前请备份并谨慎修改。" />
        </template>
      </FieldRow>
      <FieldRow label="JSON 原样保存"
        ><n-switch class="tool-switch" :value="settings.preserveOriginalJson" @update:value="settings.setPreserveOriginalJson" /><template
          #hint
          ><FieldHints description="尽量保留结构化 JSON 文件的注释与字段顺序。无法保留时会在写入前请求确认。" /></template
      ></FieldRow>
    </section>
    <section class="settings-cache-panel panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
      <h3 class="panel-section-title">缓存限制</h3>
      <h4 class="panel-section-title">撤销与历史</h4>
      <FieldHints description="工作区的全局撤销，与表格的局部撤销。" />
      <FieldRow v-for="(row, key) in HISTORY_FIELDS" :key="key" :label="row[0]"
        ><n-input-number
          class="ui-field-number"
          :value="settings[key]"
          :min="1"
          :max="MAX_HISTORY_LIMIT"
          :step="1"
          :precision="0"
          @update:value="settings[row[2]]($event ?? settings[key])" /><template #hint><FieldHints :description="row[1]" /></template
      ></FieldRow>
      <h4 class="panel-section-title">图片与媒体</h4>
      <FieldHints description="0 表示不保留相应缓存；较久未用的内容优先清理，正在使用的图片继续保留。" />
      <FieldRow v-for="(row, key) in MEDIA_CACHES" :key="key" :label="row[0]">
        <div class="action-group">
          <label v-for="unit in ['entries', 'MiB'] as const" :key="unit" class="action-group">
            <n-input-number
              class="ui-field-number"
              :value="settings.cacheLimits[key][unit]"
              :min="0"
              :max="unit === 'MiB' ? 4096 : 65536"
              :precision="0"
              :step="1"
              @update:value="settings.setCacheLimit(key, unit, $event ?? settings.cacheLimits[key][unit])"
            />{{ unit === 'entries' ? '条' : 'MiB' }}
          </label>
        </div>
        <template #hint><FieldHints :description="row[1]" /></template>
      </FieldRow>
      <h4 class="panel-section-title">查询结果</h4>
      <FieldHints description="保留已读取的查询结果，减少重复加载；0 表示不保留。" />
      <div class="settings-query-grid ui-layout-grid">
        <FieldRow v-for="(row, key) in QUERY_CACHES" :key="key" :label="row[0]">
          <label class="action-group"
            ><n-input-number
              class="ui-field-number"
              :value="settings.cacheLimits.queries[key]"
              :min="0"
              :max="65536"
              :precision="0"
              :step="1"
              @update:value="settings.setCacheLimit('queries', key, $event ?? settings.cacheLimits.queries[key])"
            />条</label
          >
          <template #hint><FieldHints :description="row[1]" /></template>
        </FieldRow>
        <FieldRow label="字体字形">
          <label class="action-group"
            ><n-input-number
              class="ui-field-number"
              :value="settings.cacheLimits.fonts.glyphEntriesPerPage"
              :min="0"
              :max="65536"
              :precision="0"
              :step="1"
              @update:value="
                settings.setCacheLimit('fonts', 'glyphEntriesPerPage', $event ?? settings.cacheLimits.fonts.glyphEntriesPerPage)
              "
            />条／图集</label
          >
          <template #hint><FieldHints description="每张原版字体图集保留的着色字形成品数量。" /></template>
        </FieldRow>
      </div>
    </section>
    <section class="panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
      <h3 class="panel-section-title">提示时长</h3>
      <FieldHints description="单位为秒，范围 0–3600。0 表示持续显示。修改后对新出现的提示生效。" />
      <FieldRow v-for="(label, level) in TOAST_LEVELS" :key="level" :label="label">
        <label class="action-group">
          <n-input-number
            class="ui-field-number"
            :value="settings.toastDurations[level]"
            :min="0"
            :max="MAX_TOAST_DURATION"
            :step="1"
            :precision="0"
            @update:value="settings.setToastDuration(level, $event ?? settings.toastDurations[level])"
          />秒
        </label>
      </FieldRow>
    </section>
    <section class="panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
      <h3 class="panel-section-title">配置文件</h3>
      <FieldRow label="日志输出目录"
        ><div class="ui-field-actions ui-layout-stretch action-group">
          <n-input :value="settings.logDirectory ?? '默认 app data'" size="small" readonly />
          <n-button size="small" @click="pickLogDirectory">选择目录</n-button>
          <n-button v-if="settings.logDirectory" size="small" quaternary @click="restoreDefaultLogDirectory">恢复默认</n-button>
        </div></FieldRow
      >
      <FieldRow label="日志级别"
        ><div class="ui-field-actions ui-layout-stretch action-group">
          <n-select :value="settings.logLevel" :options="LOG_LEVEL_OPTIONS" size="small" @update:value="updateLogLevel" /></div
      ></FieldRow>
      <FieldRow v-for="(row, key) in LOG_FIELDS" :key="key" :label="row[0]"
        ><n-input-number
          class="ui-field-number"
          :value="settings[key]"
          :min="1"
          :max="row[2]"
          :step="1"
          :precision="0"
          @update:value="settings[row[3]]($event ?? settings[key])" /><template #hint><FieldHints :description="row[1]" /></template
      ></FieldRow>

      <FieldRow readonly label="Log 文件大小"
        ><strong class="ui-emphasis">{{ formattedLogSize }}</strong></FieldRow
      >
      <FieldRow readonly label="日志状态"
        ><span
          >{{
            applicationLogError || logStatus?.recording === 'stopped'
              ? '本次运行已停止记录'
              : logStatus?.recording === 'active'
                ? '正在记录'
                : '尚未初始化'
          }}{{ logStatus ? ` · ${logStatus.level.toUpperCase()} · 待写 ${logStatus.pending} 条` : '' }}</span
        ></FieldRow
      >
      <div class="ui-field-actions action-group">
        <n-button size="small" @click="openConfigFolderAction">打开配置文件夹</n-button>
        <n-button size="small" @click="refreshLogStatus">刷新日志状态</n-button>
        <n-button size="small" type="error" secondary @click="confirmResetSettings">重置为默认配置</n-button>
        <n-button size="small" type="error" secondary @click="confirmClearLog">清除 log 文件</n-button>
      </div>
      <FieldHints
        :description="`${logPathHint}${logStatus?.dropped ? ` 未写入 ${logStatus.dropped} 条。` : ''}`"
        :warning="applicationLogError || logStatus?.lastError || ''"
      />
    </section>
    <section class="settings-debug-panel panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
      <h3 class="panel-section-title">性能调试</h3>
      <FieldRow label="性能监视">
        <n-switch class="tool-switch" :value="settings.performanceMonitorEnabled" @update:value="settings.setPerformanceMonitorEnabled" />
        <template #hint><FieldHints description="默认关闭，修改后重启应用生效。开启后自动采集，报告手动导出。" /></template>
      </FieldRow>
      <FieldRow readonly label="本次运行"
        ><span
          >{{ monitorStatus?.enabled ? '已开启' : '已关闭'
          }}{{ monitorStatus && monitorStatus.enabled !== settings.performanceMonitorEnabled ? '（重启后应用新设置）' : '' }}</span
        ></FieldRow
      >
      <FieldRow label="详细录制时长">
        <n-input-number
          v-model:value="traceSeconds"
          size="small"
          :min="1"
          :max="60"
          :step="1"
          :disabled="!monitorStatus?.enabled || !monitorStatus.traceAvailable || traceBusy"
        />
        <template #hint><FieldHints description="秒；默认 15 秒，范围 1–60 秒。" /></template>
      </FieldRow>
      <div class="action-group">
        <n-button size="small" @click="monitorAction('status')">刷新状态</n-button>
        <n-button size="small" :disabled="!monitorStatus?.enabled || traceBusy" @click="monitorAction('reset')">重新采集</n-button>
        <n-button size="small" :disabled="!monitorStatus?.enabled || traceBusy" @click="monitorAction('export')">导出报告</n-button>
        <n-button
          size="small"
          :disabled="!monitorStatus?.enabled || !monitorStatus.traceAvailable || traceBusy"
          @click="monitorAction('traceStart')"
          >开始录制</n-button
        >
        <n-button size="small" :disabled="monitorStatus?.traceState !== 'recording'" @click="monitorAction('traceStop')">结束录制</n-button>
      </div>
      <FieldHints
        :description="
          monitorStatus
            ? `记录 ${monitorStatus.records} 条，覆盖 ${monitorStatus.overwritten} 条。${monitorStatus.path} 详细录制：${monitorStatus.traceState}`
            : ''
        "
        :warning="performanceMonitorError || monitorStatus?.traceError"
      />
    </section>
  </div>
</template>

<script setup lang="ts">
import FieldRow from '@/shared/ui/FieldRow.vue';
import FieldHints from '@/shared/ui/FieldHints.vue';
import { computed, onMounted, ref, watch } from 'vue';
import type { JsonValue, LogLevel } from '@/shared/types';
import { useSettingsStore } from '@/stores/settings.store';
import { MAX_HISTORY_LIMIT, MAX_LOG_ROTATION_SIZE_MIB, MAX_LOG_BACKUP_COUNT, MAX_TOAST_DURATION } from '@/domain/settings/rules';
import { ACCENT_PRESETS } from '@/domain/settings/theme';
import ColorPicker from '@/shared/ui/ColorPicker.vue';
import { useSettingsViewModel } from '@/app/composables/settings/use-settings-view-model';
import type { CacheLimits } from '@/shared/types';

const TOAST_LEVELS = { success: '成功', info: '信息', warning: '警告', error: '错误' } as const;
const MEDIA_CACHES = {
  mediaData: ['媒体数据', '每个窗口保留的图片数据，可减少重复读取与传输。'],
  decodedImages: ['解码图片', '每个窗口保留的已解码原图，可减少重复解码。'],
  thumbnails: ['缩略图与成品', '每个窗口保留的缩略图和静态绘制成品。'],
  backendMedia: ['后端媒体', '应用共享的图片读取结果，可减少重复文件读取与编码。'],
} satisfies Record<Exclude<keyof CacheLimits, 'queries' | 'fonts'>, [string, string]>;
const QUERY_CACHES = {
  'joint-edit-catalog': ['联合编辑目录', '保留候选目录，减少重复加载列表。'],
  'joint-edit-candidate': ['联合编辑候选', '保留候选关联数据，便于切换和预览。'],
  'csv-table-window': ['CSV 表格索引', '保留表头和行索引，便于再次打开表格。'],
  'csv-source-options': ['CSV 来源选项', '保留下拉框的来源选项，减少重复查询。'],
  'csv-row-preview': ['CSV 行预览', '保留行详情，便于再次查看。'],
  'hull-references': ['船体引用', '保留船体名称和引用选项。'],
  'entity-detail': ['实体详情', '保留规格或配置详情，便于重复访问。'],
  'entity-list': ['实体列表', '保留规格或配置列表，便于切换页面。'],
} satisfies Record<keyof CacheLimits['queries'], [string, string]>;

const LOG_LEVEL_OPTIONS: { label: string; value: LogLevel }[] = [
  { label: '详细（DEBUG）', value: 'debug' },
  { label: '常规（INFO）', value: 'info' },
  { label: '警告（WARNING）', value: 'warning' },
  { label: '错误（ERROR）', value: 'error' },
];
const HISTORY_FIELDS = {
  fileHistoryLimit: [
    '文件保存历史步数',
    '每个 Mod 独立保留已保存文件的撤销历史。降低步数会立即裁剪较早的 undo 记录。',
    'setFileHistoryLimit',
  ],
  editHistoryLimit: ['编辑撤销步数', '各表格及编辑会话独立保留草稿撤销历史。降低步数会立即裁剪较早的 undo 记录。', 'setEditHistoryLimit'],
} as const;
const LOG_FIELDS = {
  logRotationSizeMiB: [
    '日志轮转大小（MiB）',
    '当前日志达到该大小时，在下一次追加前轮转。',
    MAX_LOG_ROTATION_SIZE_MIB,
    'setLogRotationSizeMiB',
  ],
  logBackupCount: ['日志备份份数', '保留最近的已轮转日志。降低份数在下次轮转时整理已有备份。', MAX_LOG_BACKUP_COUNT, 'setLogBackupCount'],
} as const;

function updateLogLevel(value: string) {
  const level = LOG_LEVEL_OPTIONS.find((option) => option.value === value);
  if (level) settings.setLogLevel(level.value);
}

const settings = useSettingsStore();
const customAccentDraft = ref(settings.customAccent);
const customAccentValid = ref(true);
const {
  fontOptions,
  fontsLoading,
  loadSystemFonts,
  formattedLogSize,
  logPathHint,
  logStatus,
  applicationLogError,
  pickLogDirectory,
  pickStarsectorRoot,
  changeStarsectorRoot,
  pickImmersiveFontDirectory,
  refreshLogStatus,
  openConfigFolderAction,
  restoreDefaultLogDirectory,
  confirmResetSettings,
  confirmClearLog,
  monitorStatus,
  monitorAction,
  traceSeconds,
  performanceMonitorError,
} = useSettingsViewModel(() => {
  customAccentDraft.value = settings.customAccent;
  customAccentValid.value = true;
});
const traceBusy = computed(() => ['starting', 'recording', 'finishing'].includes(monitorStatus.value?.traceState ?? ''));

onMounted(() => {
  void loadSystemFonts();
  void refreshLogStatus();
  void monitorAction('status');
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
