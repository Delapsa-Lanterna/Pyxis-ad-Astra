<template>
  <main class="text-editor-page ui-content-grid ui-text-normal" :data-theme="settings.theme" :inert="handoffLocked">
    <header class="text-editor-header page-header ui-layout-grid">
      <div class="text-editor-heading page-identity">
        <div class="text-editor-title-row ui-control-row">
          <h1 class="text-editor-title page-title ui-text-truncate" :title="fileName">
            {{ fileName }}
          </h1>
          <div
            class="text-editor-status ui-text-path"
            :class="{
              dirty,
              saving,
              loading,
              error: showContextMessage && isErrorContext,
              warning: Boolean(externalTextNotice) || (showContextMessage && isWarningContext),
            }"
          >
            {{ fileStatusText }}
          </div>
        </div>
        <div
          class="text-editor-path page-path ui-text-truncate ui-text-muted ui-text-reset ui-layout-shrink ui-text-path ui-text-small"
          :title="filePathText"
        >
          {{ displayPath }}
        </div>
        <div class="text-editor-meta ui-layout-row ui-layout-shrink" aria-label="文件信息">
          <span class="text-editor-meta-label ui-text-truncate ui-text-muted ui-control-border ui-content-surface-muted">{{
            fileTypeText
          }}</span>
          <span class="text-editor-meta-label ui-text-truncate ui-text-muted ui-control-border ui-content-surface-muted"
            >{{ lineCount }} 行</span
          >
          <span class="text-editor-meta-label ui-text-truncate ui-text-muted ui-control-border ui-content-surface-muted">{{
            modRootName
          }}</span>
        </div>
      </div>
      <div class="text-editor-actions action-group">
        <n-button :disabled="!contentReady || loading" @click="surface?.search()">查找与替换</n-button>
        <n-button v-if="hasPendingExternalText" secondary type="warning" @click="loadExternalText">载入外部文本</n-button>
        <n-button v-if="isErrorContext && !contentReady" @click="retryFile">重试</n-button>
        <n-button :disabled="!dirty || saving" @click="cancelFileChanges">取消</n-button>
        <n-button type="primary" :loading="saving" :disabled="!canSave" @click="saveFile">保存</n-button>
      </div>
    </header>

    <section
      v-if="externalTextNotice"
      class="text-editor-message warning ui-layout-grid ui-text-normal ui-control-border ui-content-surface-muted"
    >
      <span class="text-editor-message-label ui-text-small">外部更新</span>
      <p class="text-editor-message-description ui-text-note ui-text-wrap ui-text-reset ui-text-small">{{ externalTextNotice }}</p>
    </section>

    <section
      class="ui-layout-grid ui-text-normal ui-control-border ui-content-surface-muted"
      v-if="showContextMessage"
      :class="['text-editor-message', { danger: isErrorContext, warning: isWarningContext, info: !isErrorContext && !isWarningContext }]"
    >
      <span class="text-editor-message-label ui-text-small">{{ contextLabel }}</span>
      <p class="text-editor-message-description ui-text-note ui-text-wrap ui-text-reset ui-text-small">{{ contextMessage }}</p>
    </section>

    <section class="text-editor-body ui-content-contained ui-layout-grid ui-control-border ui-content-surface" :aria-busy="loading">
      <TextEditorSurface ref="surface" :document="document" :disabled="loading" :line="targetLine" line-numbers />
    </section>
  </main>
</template>

<script setup lang="ts">
import TextEditorSurface from '@/shared/ui/TextEditorSurface.vue';
import { provideFieldInputs } from '@/shared/runtime/field-inputs';
import { computed, nextTick, onMounted, onUnmounted, useTemplateRef, watch } from 'vue';
import { useWindowCloseParticipant } from '@/app/composables/use-window-close-state';
import { useTextEditorViewModel } from '@/app/composables/editors/use-text-editor-view-model';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSettingsStore } from '@/stores/settings.store';
import { closeCurrentWindow } from '@/windows/current.window';
import { useWindowContext } from '@/windows/window-context.window';
import { useManagedWindowRequests } from '@/app/composables/use-managed-window-requests';
import { pathBasename, pathBelongsToRoot, relativePathFromRoot } from '@/shared/lib/paths';

const context = useWindowContext('text-editor').value;
const settings = useSettingsStore();
const feedback = useAppFeedback();
const initialFilePath = context.identity.path;
const modRoot = context.identity.modRoot;
const sessionId = context.identity.type === 'text-editor' ? context.identity.sessionId : null;
const filePathText = computed(() => filePath.value ?? '缺少文件路径');
const fileName = computed(() => (filePath.value ? pathBasename(filePath.value) : '缺少文件路径'));
const displayPath = computed(() => {
  if (!filePath.value) return '缺少文件路径';
  if (modRoot && pathBelongsToRoot(filePath.value, modRoot)) return relativePathFromRoot(modRoot, filePath.value);
  return filePath.value;
});
const fileTypeText = computed(() => {
  const name = fileName.value;
  const extension = name.includes('.') ? name.split('.').pop()?.toUpperCase() : '';
  return extension ? `${extension} 文本` : '文本文件';
});
const modRootName = computed(() => (modRoot ? pathBasename(modRoot) : '未知 Mod'));
const surface = useTemplateRef<InstanceType<typeof TextEditorSurface>>('surface');
const {
  document,
  inputs,
  filePath,
  contentReady,
  contextLabel,
  contextMessage,
  targetLine,
  targetColumn,
  loading,
  saving,
  handoffLocked,
  dirty,
  canSave,
  hasPendingExternalText,
  externalTextNotice,
  lineCount,
  isErrorContext,
  isWarningContext,
  initialize,
  retry,
  dispose,
  saveFile,
  cancelChanges,
  loadPendingExternalText,
  applyLocation,
  undoEdit,
  redoEdit,
} = useTextEditorViewModel({
  filePath: initialFilePath,
  mode: context.identity.type === 'recovery' ? 'recovery' : 'session',
  modRoot,
  sessionId,
  title: context.title,
  line: context.input.location.line,
  column: context.input.location.column,
});
provideFieldInputs(inputs);
useManagedWindowRequests(async (request) => {
  if (request.kind === 'text-editor') applyLocation(request.input.location);
  await initialize();
  await nextTick();
  scrollToTargetLine();
});
const showContextMessage = computed(() => Boolean(contextMessage.value && (isErrorContext.value || targetLine.value)));
const closeParticipant = useWindowCloseParticipant({
  content: '这个文件有未保存修改，关闭后将丢弃这些修改。',
  dirty,
  title: '放弃未保存文件修改？',
});
const fileStatusText = computed(() => {
  if (loading.value) return '正在读取文件…';
  if (saving.value) return '保存中';
  if (isErrorContext.value && !contentReady.value) return '读取失败';
  if (hasPendingExternalText.value) return '外部文本已更新';
  return dirty.value ? '未保存' : '已保存';
});

function scrollToTargetLine() {
  if (targetLine.value) surface.value?.locate(targetLine.value, targetColumn.value ?? 1);
}
async function retryFile() {
  if (await retry()) {
    await nextTick();
    scrollToTargetLine();
  }
}

function restoreEditorFocus() {
  surface.value?.focus();
}

function undoTextEdit() {
  undoEdit();
  void nextTick(restoreEditorFocus);
}

function redoTextEdit() {
  redoEdit();
  void nextTick(restoreEditorFocus);
}

function cancelFileChanges() {
  cancelChanges();
  void nextTick(scrollToTargetLine);
}

function loadExternalText() {
  loadPendingExternalText();
  void nextTick(scrollToTargetLine);
}

async function closeEditorWindow() {
  try {
    await closeCurrentWindow();
  } catch (error) {
    feedback.error(error, '关闭窗口失败');
  }
}

useWindowShortcuts({
  undoRedoInEditable: true,
  commands: {
    close: () => void closeEditorWindow(),
    save: () => void saveFile(),
    undo: undoTextEdit,
    redo: redoTextEdit,
  },
});

onMounted(() => {
  void closeParticipant.install().catch((error) => feedback.error(error, '登记关闭保护失败'));
});

watch([targetLine, targetColumn], () => void nextTick(scrollToTargetLine));

onUnmounted(() => {
  dispose();
});
</script>
