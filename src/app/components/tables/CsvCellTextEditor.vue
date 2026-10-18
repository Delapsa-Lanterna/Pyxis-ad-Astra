<template>
  <div
    class="csv-cell-text-editor ui-layout-row ui-layout-stack ui-control-border ui-content-surface"
    :style="editorStyle"
    tabindex="-1"
    @mousedown.stop
  >
    <textarea
      ref="textRef"
      :value="value"
      @input="updateText"
      class="csv-cell-text-input ui-textarea ui-text-normal ui-control-border"
      spellcheck="false"
      @keydown.enter.ctrl.prevent="commit"
      @keydown.esc.prevent="cancel"
    ></textarea>
    <div class="csv-cell-text-actions ui-control-between">
      <span class="csv-cell-text-hint ui-text-muted">Ctrl+Enter 提交，Esc 取消</span>
      <button type="button" class="csv-cell-text-commit ui-button ui-text-small" @click="commit">提交</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, useTemplateRef } from 'vue';
import { useCsvFloatingPanel, useCsvFloatingViewport } from '@/app/composables/tables/use-csv-floating-panel';

const props = defineProps<{
  anchor: { height: number; left: number; top: number; width: number };
  value: string;
}>();

const emit = defineEmits<{
  update: [value: string];
  cancel: [];
  commit: [value: string];
}>();
const floating = useCsvFloatingViewport();

// Mirrors the .csv-cell-text-editor height in tables.css.
const EDITOR_HEIGHT = 260;

const textRef = useTemplateRef<HTMLTextAreaElement>('textRef');

const panelStyle = useCsvFloatingPanel(() => props.anchor, EDITOR_HEIGHT);
const editorStyle = computed(() => ({ ...panelStyle.value, height: `${EDITOR_HEIGHT}px` }));

let settled = false;

function commit() {
  if (settled) return;
  settled = true;
  emit('commit', props.value);
}

function cancel() {
  if (settled) return;
  settled = true;
  emit('cancel');
}

function updateText(event: Event) {
  emit('update', (event.target as HTMLTextAreaElement).value);
}

function focusText() {
  const area = textRef.value;
  if (!area) return;
  area.focus({ preventScroll: true });
  area.setSelectionRange(area.value.length, area.value.length);
}

function handleDocumentMouseDown(event: MouseEvent) {
  if (event.target === floating?.panel.value) return;
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  if (target?.closest?.('.csv-grid-cell')) return;
  if (target?.closest?.('.csv-cell-text-editor')) return;
  commit();
}

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMouseDown, true);
  void nextTick(focusText);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown, true);
});

defineExpose({ focus: focusText });
</script>
