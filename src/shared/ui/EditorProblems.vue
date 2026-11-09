<template>
  <div v-if="visibleIssues.length" class="editor-problems ui-content-column ui-content-contained ui-text-small">
    <section
      v-for="level in levels"
      :key="level"
      v-show="items(level).length"
      class="editor-problem ui-content-column ui-content-contained"
      :class="level"
      :role="level === 'error' ? 'alert' : 'status'"
    >
      <strong>{{ level === 'error' ? (isBlocking ? '错误' : '无法保存') : '保存前请确认' }} ({{ items(level).length }})</strong>
      <ul class="editor-problem-list ui-content-scroll ui-text-reset">
        <li
          v-for="issue in items(level)"
          :key="fieldProblemKey(issue)"
          role="button"
          tabindex="0"
          title="点击定位到对应位置"
          class="ui-control-pointer"
          @click="$emit('locate', issue)"
          @keydown.enter="$emit('locate', issue)"
          @keydown.space.prevent="$emit('locate', issue)"
        >
          {{ issue.message }}
          <small v-if="issue.location?.path" class="ui-text-muted"> · {{ issue.location.path }}</small>
          <span v-if="isBlocking && !isBlocking(issue)" class="ui-text-muted"> · 来源问题</span>
        </li>
      </ul>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldProblem } from '@/shared/types';
import { fieldProblemKey } from '@/shared/runtime/editor-problems';
const props = defineProps<{ issues: readonly FieldProblem[]; ignoreWarnings?: boolean; isBlocking?: (issue: FieldProblem) => boolean }>();
defineEmits<{ locate: [issue: FieldProblem] }>();
const visibleIssues = computed(() => (props.ignoreWarnings ? props.issues.filter((issue) => issue.severity === 'error') : props.issues));
const levels = ['error', 'warning'] as const;
const items = (level: (typeof levels)[number]) => visibleIssues.value.filter((item) => item.severity === level);
</script>
