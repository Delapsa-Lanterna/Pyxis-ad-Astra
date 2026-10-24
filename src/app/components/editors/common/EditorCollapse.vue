<template>
  <div class="schema-form editor-collapse"><slot /></div>
</template>
<script setup lang="ts">
import { provide, useSlots } from 'vue';
import { editorCollapseKey } from './editor-collapse';
const expanded = defineModel<(string | number)[]>('expandedNames', { required: true });
function toggle(name: string | number) {
  expanded.value = expanded.value.includes(name) ? expanded.value.filter((value) => value !== name) : [...expanded.value, name];
}
provide(editorCollapseKey, { expanded, toggle, slots: useSlots() });
</script>
