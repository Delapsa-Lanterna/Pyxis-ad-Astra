<template>
  <aside aria-label="类与方法大纲" class="code-outline ui-content-scroll">
    <h2 class="code-region-title">类与方法大纲</h2>
    <p v-if="!entries.length" class="ui-text-muted">{{ status.includes('就绪') ? '当前文件没有类或方法' : status }}</p>
    <button
      v-for="entry in entries"
      :key="entry.range.start"
      class="code-outline-entry ui-button ui-control-row ui-control-button"
      :class="{ active: current === entry }"
      :style="{ '--outline-depth': entry.depth }"
      :title="entry.name"
      :aria-label="entry.name"
      :aria-current="current === entry ? 'location' : undefined"
      @click="emit('locate', entry.range)"
    >
      <svg class="ui-control-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          :d="entry.kind === 'MethodDeclaration' ? 'M3 5h10v6H3zM6 2v3m4-3v3m-4 6v3m4-3v3' : 'm8 2 6 3v6l-6 3-6-3V5zm-6 3 6 3 6-3M8 8v6'"
        />
      </svg>
      <span class="ui-text-truncate">{{ entry.name }}</span>
    </button>
  </aside>
</template>
<script setup lang="ts">
import type { JavaInspection, JavaLocation } from '@/shared/types';
import { computed } from 'vue';
const props = defineProps<{ entries: JavaInspection['outline']; offset: number; status: string }>();
const current = computed(() => props.entries.findLast((entry) => entry.range.start <= props.offset));
const emit = defineEmits<{ locate: [range: JavaLocation['range']] }>();
</script>
