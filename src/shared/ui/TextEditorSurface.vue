<template>
  <div class="text-editor-surface ui-content-contained" @keydown="searchInputKey">
    <div v-if="document.lightweight.value" class="ui-notice" role="status">
      轻量显示：文件含超过 20,000 个字符的单行，Java 高亮、语法缩进和折叠已暂停。
    </div>
    <div ref="host" class="text-editor-view ui-content-contained" />
  </div>
</template>
<script setup lang="ts">
import { onMounted, onBeforeUnmount, useTemplateRef, watch } from 'vue';
import { EditorState, RangeSet, type Extension } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutterLineClass, keymap, lineNumbers as numberedGutter } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import type { TextDocument } from '@/shared/runtime/text-document';
const props = defineProps<{ document: TextDocument; disabled?: boolean; lineNumbers?: boolean; line?: number }>();
const emit = defineEmits<{ position: [value: { line: number; column: number }] }>();
const host = useTemplateRef<HTMLElement>('host');
const errorGutter = new (class extends GutterMarker {
  override elementClass = 'text-editor-error-gutter';
})();
let view: EditorView | undefined, bound: TextDocument | undefined, stop: (() => void) | undefined;
function searchInputKey(event: KeyboardEvent) {
  if (
    (event.ctrlKey || event.metaKey) &&
    ['z', 'y'].includes(event.key.toLowerCase()) &&
    (event.target as HTMLElement).closest('.cm-search input')
  )
    event.stopPropagation();
}
function position() {
  const state = bound!.state.value,
    offset = state.selection.main.head,
    line = state.doc.lineAt(offset);
  emit('position', { line: line.number, column: offset - line.from + 1 });
}
function bind() {
  if (!host.value) return;
  if (view?.composing) {
    void bound!.waitForInput().then(bind);
    return;
  }
  stop?.();
  if (view && bound) bound.scroll = view.scrollSnapshot();
  bound = props.document;
  const line = props.line;
  const marker = (state: EditorState) => (line && line <= state.doc.lines ? state.doc.line(line).from : null);
  const extensions: Extension = [
    // Native composition mutations settle before the application's input finalizer captures text.
    EditorView.domEventHandlers({
      compositionstart() {
        bound!.startComposition();
      },
      compositionend() {
        const document = bound!;
        setTimeout(() => document.finishComposition(), 0);
      },
    }),
    keymap.of(defaultKeymap),
    EditorState.readOnly.of(Boolean(props.disabled)),
    EditorView.editable.of(!props.disabled),
    EditorView.contentAttributes.of({ 'aria-label': '文件内容', spellcheck: 'false' }),
    EditorView.decorations.compute(['doc'], (state) => {
      const from = marker(state);
      return from === null ? Decoration.none : Decoration.set([Decoration.line({ class: 'text-editor-error-line' }).range(from)]);
    }),
    props.lineNumbers
      ? [
          numberedGutter(),
          gutterLineClass.compute(['doc'], (state) => {
            const from = marker(state);
            return from === null ? RangeSet.empty : RangeSet.of(errorGutter.range(from));
          }),
        ]
      : [],
  ];
  bound.configureSurface(extensions);
  if (view) view.setState(bound.state.value);
  else
    view = new EditorView({
      parent: host.value,
      state: bound.state.value,
      dispatchTransactions(transactions, editor) {
        editor.update(transactions);
        bound!.dispatchTransactions(transactions);
        position();
      },
    });
  if (bound.scroll) view.dispatch({ effects: bound.scroll });
  else view.dispatch({ effects: EditorView.scrollIntoView(bound.state.value.selection.main.head, { y: 'start' }) });
  stop = watch(
    bound.state,
    (state) => {
      if (view!.state !== state) {
        const transaction = bound!.transaction;
        if (transaction?.startState === view!.state) view!.update([transaction]);
        else view!.setState(state);
      }
      position();
    },
    { flush: 'sync' },
  );
  position();
}
watch([() => props.document, () => props.disabled, () => props.lineNumbers, () => props.line], bind, { flush: 'post' });
onMounted(bind);
onBeforeUnmount(() => {
  stop?.();
  if (view && bound) bound.scroll = view.scrollSnapshot();
  view?.destroy();
});
defineExpose({
  search: () => view && openSearchPanel(view),
  focus: () => view?.focus(),
  locate: (line: number, column = 1) => {
    props.document.locate(line, column);
    view?.focus();
  },
});
</script>
