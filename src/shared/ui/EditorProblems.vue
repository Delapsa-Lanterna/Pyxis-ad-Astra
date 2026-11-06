<template>
  <div v-if="issues.length" class="editor-problems ui-content-column ui-content-contained ui-text-small">
    <section
      v-for="level in levels"
      :key="level"
      v-show="items(level).length"
      class="editor-problem ui-content-column ui-content-contained"
      :class="level"
      :role="level === 'error' ? 'alert' : 'status'"
    >
      <strong>{{ level === 'error' ? '无法保存' : '保存前请确认' }} ({{ items(level).length }})</strong>
      <ul class="editor-problem-list ui-content-scroll ui-text-reset">
        <li v-for="issue in items(level)" :key="`${issue.code}:${issue.path}`">{{ issue.message }}</li>
      </ul>
    </section>
  </div>
</template>
<script setup lang="ts">
import type { FieldProblem } from '@/shared/types';
const props = defineProps<{ issues: readonly FieldProblem[] }>();
const levels = ['error', 'warning'] as const;
const items = (level: (typeof levels)[number]) => props.issues.filter((item) => item.severity === level);
</script>
