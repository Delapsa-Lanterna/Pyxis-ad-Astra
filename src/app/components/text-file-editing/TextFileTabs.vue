<template>
  <nav class="code-editor-tabs ui-control-row ui-content-surface-muted" aria-label="已打开文件">
    <slot name="leading" />
    <div ref="list" class="mod-tabs-list ui-layout-row" role="tablist">
      <div
        v-for="document in files"
        :key="document.path.value"
        class="mod-tab ui-layout-row ui-layout-center"
        :class="{
          active: active === document,
          'drop-before': target === document && !dropAfter,
          'drop-after': target === document && dropAfter,
        }"
        :title="document.path.value"
        @dragover.prevent="dragOver($event, document)"
        @drop.prevent="drop(document)"
      >
        <button
          class="mod-tab-activate ui-button ui-control-row ui-control-button ui-control-pointer ui-layout-row ui-layout-center"
          role="tab"
          :aria-selected="active === document"
          :aria-description="status(document).label"
          draggable="true"
          @dragstart="dragged = document"
          @dragend="endDrag"
          @click="emit('activate', document)"
        >
          <span class="mod-tab-name ui-text-truncate">{{ label(document) }}</span>
          <span v-if="document.readOnly" class="code-readonly">引用，只读</span>
          <span :class="status(document).className" :title="status(document).label" aria-hidden="true" />
        </button>
        <button
          class="mod-tab-close ui-button ui-control-button ui-text-muted ui-layout-grid ui-control-reset ui-control-pointer"
          :aria-label="`关闭 ${label(document)}`"
          @click="emit('close', document)"
        >
          <svg class="mod-tab-close-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
        </button>
      </div>
    </div>
  </nav>
</template>
<script setup lang="ts">
import { nextTick, onScopeDispose, ref, shallowRef, useTemplateRef, watch } from 'vue';
import type { TextFile } from '@/app/composables/text-file-editing/use-text-file';
import { fileTabStatus } from '@/domain/text-file-editing/file-tabs';
const props = defineProps<{ files: TextFile[]; active: TextFile | null; label: (file: TextFile) => string }>();
const emit = defineEmits<{
  activate: [file: TextFile];
  close: [file: TextFile];
  move: [file: TextFile, target: TextFile, after: boolean];
}>();
const dragged = shallowRef<TextFile | null>(null);
const target = shallowRef<TextFile | null>(null),
  dropAfter = ref(false),
  list = useTemplateRef<HTMLElement>('list');
let frame = 0,
  scroll = 0;
function status(file: TextFile) {
  return fileTabStatus(file.dirty.value, Boolean(file.problem.value), file.session.saving.value, file.readOnly);
}
watch(
  () => [props.active, props.files.length],
  async () => {
    await nextTick();
    const selected = list.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.parentElement;
    if (selected && list.value) {
      const bounds = selected.getBoundingClientRect(),
        area = list.value.getBoundingClientRect();
      if (bounds.left < area.left) list.value.scrollLeft -= area.left - bounds.left;
      else if (bounds.right > area.right) list.value.scrollLeft += bounds.right - area.right;
    }
  },
  { immediate: true, flush: 'post' },
);
function dragOver(event: DragEvent, file: TextFile) {
  if (!dragged.value) return;
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  target.value = file;
  dropAfter.value = event.clientX > bounds.x + bounds.width / 2;
  const area = list.value!.getBoundingClientRect();
  scroll = event.clientX < area.left + 32 ? -12 : event.clientX > area.right - 32 ? 12 : 0;
  if (!frame) frame = requestAnimationFrame(scrollDrag);
}
function scrollDrag() {
  list.value!.scrollLeft += scroll;
  frame = scroll ? requestAnimationFrame(scrollDrag) : 0;
}
function endDrag() {
  dragged.value = target.value = null;
  cancelAnimationFrame(frame);
  frame = scroll = 0;
}
function drop(file: TextFile) {
  if (dragged.value) emit('move', dragged.value, file, dropAfter.value);
  endDrag();
}
onScopeDispose(endDrag);
</script>
