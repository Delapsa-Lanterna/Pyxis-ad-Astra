<template>
  <main class="code-editor ui-content-contained ui-layout-grid ui-text-normal" :inert="Boolean(closing)">
    <nav class="code-editor-tabs ui-content-surface-muted" aria-label="已打开文件">
      <div class="mod-tabs-list ui-layout-row" role="tablist">
        <div
          v-for="document in documents"
          :key="document.path.value"
          class="mod-tab ui-layout-row ui-layout-center"
          :class="{ active: active === document }"
          :title="document.path.value"
          @dragover.prevent="dragOver($event)"
          @drop.prevent="drop(document)"
        >
          <button
            class="mod-tab-activate ui-button ui-control-row ui-control-button ui-control-pointer ui-layout-row ui-layout-center"
            role="tab"
            :aria-selected="active === document"
            draggable="true"
            @dragstart="dragged = document"
            @dragend="dragged = null"
            @click="activate(document)"
          >
            <span class="mod-tab-name ui-text-truncate">{{ label(document) }}</span
            ><span v-if="document.session.dirty.value" class="mod-tab-dirty" title="未保存" />
          </button>
          <button
            class="mod-tab-close ui-button ui-control-button ui-text-muted ui-layout-grid ui-control-reset ui-control-pointer"
            :aria-label="`关闭 ${label(document)}`"
            @click="run(() => close(document))"
          >
            <svg class="mod-tab-close-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
          </button>
        </div>
      </div>
    </nav>
    <div class="code-editor-tools ui-control-row">
      <span class="ui-text-path ui-text-truncate" :title="active?.path.value">{{ active?.path.value ?? '请选择要打开的文件' }}</span>
      <div class="action-group ui-layout-row">
        <n-button size="small" :disabled="!active?.session.dirty.value" @click="run(() => save())">保存</n-button
        ><n-button size="small" :disabled="!dirty" @click="run(saveAll)">保存全部</n-button>
      </div>
    </div>
    <div v-if="active && (active.session.hasPendingExternalValue.value || active.problem.value)">
      <div v-if="active.session.hasPendingExternalValue.value" class="ui-notice" role="status">
        外部文本已更新，当前草稿已保留。<n-button size="small" @click="loadExternal(active)">载入外部文本</n-button>
      </div>
      <div v-if="active.problem.value" class="ui-notice" role="status">{{ active.problem.value.message }}</div>
    </div>
    <textarea
      v-if="active"
      ref="surface"
      class="code-editor-text ui-textarea ui-content-scroll"
      aria-label="文件内容"
      spellcheck="false"
      wrap="off"
      @input="input"
      @beforeinput="captureSelection"
      @scroll="remember()"
      @select="remember()"
      @keyup="remember()"
      @compositionstart="startComposition"
      @compositionend="endComposition"
    />
    <section v-else class="empty-state ui-content-grid">
      <h1 class="page-title">代码编辑器</h1>
      <p class="ui-text-muted">文件将在独立标签中打开。</p>
    </section>
    <footer class="code-editor-status ui-text-muted ui-text-small">
      {{ documents.length }} 个文件<template v-if="active">
        · {{ active.session.saving.value ? '保存中' : active.session.dirty.value ? '未保存' : '已保存' }} · 行 {{ position.line }}，列
        {{ position.column }}</template
      >
    </footer>
  </main>
</template>
<script setup lang="ts">
import { nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { useCodeEditorWindow } from '@/app/composables/code-editor/use-code-editor-window';
import type { CodeDocument } from '@/app/composables/code-editor/use-code-document';
import { applyTextInput } from '@/domain/code-editor/documents';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { closeCurrentWindow } from '@/windows/current.window';

const host = useCodeEditorWindow();
const { documents, active, location, dirty, label, close, save, saveAll, loadExternal, closing } = host;
const feedback = useAppFeedback();
const surface = useTemplateRef<HTMLTextAreaElement>('surface');
const dragged = shallowRef<CodeDocument | null>(null);
let dropAfter = false;
const composing = ref(false);
let compositionBefore = '';
let afterComposition: (() => void) | null = null;
let selection: { start: number; end: number } | undefined;
let rendered = '';
let renderedSurface: HTMLTextAreaElement | null = null;
let positioned: CodeDocument | null = null;
let positionedOffset = -1;
let positionedText: string | undefined;
const position = ref({ line: 1, column: 1 });
function remember(document = active.value) {
  const input = surface.value;
  if (!document || !input) return;
  Object.assign(document.view, {
    start: input.selectionStart,
    end: input.selectionEnd,
    direction: input.selectionDirection,
    top: input.scrollTop,
    left: input.scrollLeft,
  });
  if (positioned !== document || positionedOffset !== input.selectionStart || positionedText !== document.surfaceText.value) {
    const before = document.surfaceText.value.slice(0, input.selectionStart);
    position.value = { line: (before.match(/\n/g)?.length ?? 0) + 1, column: before.length - before.lastIndexOf('\n') };
    positioned = document;
    positionedOffset = input.selectionStart;
    positionedText = document.surfaceText.value;
  }
}
function restore() {
  if (!active.value || !surface.value) return;
  synchronizeText();
  const view = active.value.view;
  surface.value.setSelectionRange(view.start, view.end, view.direction);
  surface.value.scrollTop = view.top;
  surface.value.scrollLeft = view.left;
  if (document.activeElement !== surface.value) surface.value.focus({ preventScroll: true });
  remember();
}
function activate(document: CodeDocument) {
  if (composing.value) {
    afterComposition = () => activate(document);
    return;
  }
  remember();
  active.value = document;
}
function synchronizeText() {
  const text = active.value?.surfaceText.value ?? '';
  if (surface.value && (renderedSurface !== surface.value || rendered !== text)) surface.value.value = text;
  renderedSurface = surface.value;
  rendered = text;
}
function captureSelection(event: InputEvent) {
  const input = surface.value!;
  selection = /^(insert(Text|LineBreak|Paragraph|CompositionText|FromPaste)$|delete)/.test(event.inputType)
    ? { start: input.selectionStart, end: input.selectionEnd }
    : undefined;
}
function input() {
  if (active.value && surface.value) {
    rendered = surface.value.value;
    const text = applyTextInput(
      active.value.session.draftValue.value,
      rendered,
      selection && { ...selection, caret: surface.value.selectionStart },
    );
    if (composing.value) active.value.session.setDraft(text);
    else active.value.setText(text);
    selection = undefined;
  }
  remember();
}
function startComposition() {
  composing.value = true;
  compositionBefore = active.value!.session.draftValue.value;
}
function endComposition() {
  input();
  composing.value = false;
  active.value?.setText(active.value.session.draftValue.value, compositionBefore);
  compositionBefore = '';
  const action = afterComposition;
  afterComposition = null;
  action?.();
}
function run(action: () => Promise<unknown>) {
  void action().catch((error) => feedback.error(error, '代码编辑器操作失败'));
}
function dragOver(event: DragEvent) {
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dropAfter = event.clientX > bounds.x + bounds.width / 2;
}
function drop(document: CodeDocument) {
  if (dragged.value) host.move(dragged.value, document, dropAfter);
  dragged.value = null;
}
watch(
  [active, location],
  ([next], [previous]) => {
    if (previous !== next) remember(previous);
    if (!next) {
      positioned = null;
      positionedOffset = -1;
      positionedText = undefined;
    }
    void nextTick(restore);
  },
  { flush: 'pre' },
);
watch(() => active.value?.surfaceText.value, synchronizeText, { flush: 'post' });
useWindowShortcuts({
  undoRedoInEditable: true,
  commands: {
    save: () => run(() => save()),
    close: () => run(closeCurrentWindow),
    undo: () => {
      active.value?.undo();
      void nextTick(restore);
    },
    redo: () => {
      active.value?.redo();
      void nextTick(restore);
    },
  },
});
</script>
