<template>
  <main class="file-editor-page ui-content-grid ui-text-normal" :data-theme="settings.theme" :inert="handoffLocked">
    <header class="file-editor-header page-header ui-layout-grid">
      <div class="file-editor-heading page-identity">
        <div class="file-editor-title-row ui-control-row">
          <h1 class="file-editor-title page-title ui-text-truncate" :title="fileName">
            {{ fileName }}
          </h1>
          <div
            class="file-editor-status ui-text-path"
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
          class="file-editor-path page-path ui-text-truncate ui-text-muted ui-text-reset ui-layout-shrink ui-text-path ui-text-small"
          :title="filePathText"
        >
          {{ displayPath }}
        </div>
        <div class="file-editor-meta ui-layout-row ui-layout-shrink" aria-label="文件信息">
          <span class="file-editor-meta-label ui-text-truncate ui-text-muted ui-control-border ui-content-surface-muted">{{
            fileTypeText
          }}</span>
          <span class="file-editor-meta-label ui-text-truncate ui-text-muted ui-control-border ui-content-surface-muted"
            >{{ lineCount }} 行</span
          >
          <span class="file-editor-meta-label ui-text-truncate ui-text-muted ui-control-border ui-content-surface-muted">{{
            modRootName
          }}</span>
        </div>
      </div>
      <div class="file-editor-actions action-group">
        <n-button v-if="hasPendingExternalText" secondary type="warning" @click="loadExternalText">载入外部文本</n-button>
        <n-button v-if="isErrorContext && !contentReady" @click="reloadCurrentWindow">重试</n-button>
        <n-button :disabled="!dirty || saving" @click="cancelFileChanges">取消</n-button>
        <n-button type="primary" :loading="saving" :disabled="!canSave" @click="saveFile">保存</n-button>
      </div>
    </header>

    <section
      v-if="externalTextNotice"
      class="file-editor-message warning ui-layout-grid ui-text-normal ui-control-border ui-content-surface-muted"
    >
      <span class="file-editor-message-label ui-text-small">外部更新</span>
      <p class="file-editor-message-description ui-text-note ui-text-wrap ui-text-reset ui-text-small">{{ externalTextNotice }}</p>
    </section>

    <section
      class="ui-layout-grid ui-text-normal ui-control-border ui-content-surface-muted"
      v-if="showContextMessage"
      :class="['file-editor-message', { danger: isErrorContext, warning: isWarningContext, info: !isErrorContext && !isWarningContext }]"
    >
      <span class="file-editor-message-label ui-text-small">{{ contextLabel }}</span>
      <p class="file-editor-message-description ui-text-note ui-text-wrap ui-text-reset ui-text-small">{{ contextMessage }}</p>
    </section>

    <section class="file-editor-body ui-content-contained ui-layout-grid ui-control-border ui-content-surface" :aria-busy="loading">
      <div
        ref="lineGutterRef"
        class="file-editor-gutter ui-text-muted ui-text-small ui-layout-clip ui-content-surface-muted"
        aria-hidden="true"
      >
        <div v-for="lineNumber in lineCount" :key="lineNumber" :class="['file-editor-line-number', { active: lineNumber === targetLine }]">
          {{ lineNumber }}
        </div>
      </div>
      <textarea
        ref="textareaRef"
        :value="text"
        class="file-editor-textarea ui-textarea ui-content-scroll ui-text-normal ui-text-small ui-layout-stretch"
        spellcheck="false"
        :disabled="loading"
        @input="handleTextInput"
        @scroll="syncScroll"
      />
      <div v-if="targetLine" class="file-editor-line-highlight" :style="{ top: `${(targetLine - 1) * lineHeight - scrollTop}px` }" />
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { useDirtyWindowCloseGuard } from '@/app/composables/use-dirty-window-close-guard';
import { useFileEditorViewModel } from '@/app/composables/editors/use-file-editor-view-model';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { useSettingsStore } from '@/stores/settings.store';
import { closeCurrentWindow, reloadCurrentWindow } from '@/windows/current.window';
import { useWindowContext } from '@/windows/window-context.window';
import { useManagedWindowRequests } from '@/app/composables/use-managed-window-requests';
import { pathBasename, pathBelongsToRoot, relativePathFromRoot } from '@/shared/lib/paths';

const context = useWindowContext('file-editor').value;
const settings = useSettingsStore();
const initialFilePath = context.identity.path;
const modRoot = context.identity.modRoot;
const sessionId = context.identity.type === 'file' ? context.identity.sessionId : null;
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
const scrollTop = ref(0);
const lineHeight = 20;
const textareaRef = useTemplateRef<HTMLTextAreaElement>('textareaRef');
const lineGutterRef = useTemplateRef<HTMLElement>('lineGutterRef');
const {
  filePath,
  contentReady,
  contextLabel,
  contextMessage,
  targetLine,
  targetColumn,
  text,
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
  dispose,
  saveFile,
  cancelChanges,
  loadPendingExternalText,
  updateText,
  applyLocation,
  undoEdit,
  redoEdit,
} = useFileEditorViewModel({
  filePath: initialFilePath,
  mode: context.identity.type === 'recovery' ? 'recovery' : 'session',
  modRoot,
  sessionId,
  title: context.title,
  contextLabel: context.input.location.contextLabel ?? '信息',
  contextSeverity: context.input.location.contextSeverity ?? 'info',
  contextMessage: context.input.location.message ?? '',
  line: context.input.location.line,
  column: context.input.location.column,
});
useManagedWindowRequests(async (request) => {
  await initialize();
  if (request.kind === 'file-editor') applyLocation(request.input.location);
  await nextTick();
  scrollToTargetLine();
});
const showContextMessage = computed(() => Boolean(contextMessage.value && (isErrorContext.value || targetLine.value)));
const closeGuard = useDirtyWindowCloseGuard({
  content: '当前文件有未保存修改，关闭后这些修改将丢失。',
  dirty,
  title: '放弃未保存文件修改？',
});
const fileStatusText = computed(() => {
  if (loading.value) return '读取中';
  if (saving.value) return '保存中';
  if (hasPendingExternalText.value) return '外部文本已更新';
  return dirty.value ? '未保存' : '已保存';
});

function syncScroll() {
  scrollTop.value = textareaRef.value?.scrollTop ?? 0;
  if (lineGutterRef.value) lineGutterRef.value.scrollTop = scrollTop.value;
}

function scrollToTargetLine() {
  if (!targetLine.value || !textareaRef.value) return;
  textareaRef.value.scrollTop = Math.max(0, (targetLine.value - 4) * lineHeight);
  const offset = textOffsetAt(text.value, targetLine.value, targetColumn.value ?? 1);
  textareaRef.value.focus({ preventScroll: true });
  textareaRef.value.setSelectionRange(offset, offset);
  syncScroll();
}

function handleTextInput(event: Event) {
  const nextText = (event.target as HTMLTextAreaElement).value;
  updateText(nextText);
}

function restoreEditorFocus() {
  textareaRef.value?.focus({ preventScroll: true });
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
  await closeCurrentWindow();
}

// Text surface: undo/redo must work inside the textarea, so this surface opts in.
useShortcutDispatch({
  undoRedoInEditable: true,
  commands: {
    close: () => void closeEditorWindow(),
    save: () => void saveFile(),
    undo: undoTextEdit,
    redo: redoTextEdit,
  },
});

onMounted(() => {
  void closeGuard.install();
});

watch([targetLine, targetColumn], () => void nextTick(scrollToTargetLine));

onUnmounted(() => {
  closeGuard.dispose();
  dispose();
});

function textOffsetAt(value: string, line: number, column: number): number {
  const lines = value.split(/\r\n|\r|\n/);
  const targetLineIndex = Math.min(Math.max(line - 1, 0), Math.max(lines.length - 1, 0));
  let offset = 0;
  let currentLine = 0;
  const lineBreakPattern = /\r\n|\r|\n/g;
  while (currentLine < targetLineIndex) {
    const match = lineBreakPattern.exec(value);
    if (!match) return value.length;
    offset = match.index + match[0].length;
    currentLine += 1;
  }
  return offset + Math.min(Math.max(column - 1, 0), lines[targetLineIndex]?.length ?? 0);
}
</script>
