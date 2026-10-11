<template>
  <div class="joint-conflict-list">
    <section v-for="(conflict, index) in conflicts" :key="JSON.stringify([conflict.recordKey, conflict.path])" class="joint-conflict-row">
      <strong>{{ conflict.recordKey }} / {{ conflict.path.join('.') || '整条记录' }}</strong>
      <dl>
        <dt>原基线</dt>
        <dd>
          <pre>{{ conflictValueText(conflict.baseline) }}</pre>
        </dd>
        <dt>当前磁盘</dt>
        <dd>
          <pre>{{ conflictValueText(conflict.disk) }}</pre>
        </dd>
        <dt>本窗口</dt>
        <dd>
          <pre>{{ conflictValueText(conflict.draft) }}</pre>
        </dd>
      </dl>
      <n-select :value="choices[index]?.choice" :options="choiceOptions" @update:value="choose(index, $event)" />
    </section>
  </div>
</template>
<script setup lang="ts">
import type { JointEditConflict, JointConflictChoice } from '@/shared/types';
import { conflictValueText } from '@/domain/joint-edit';
const props = defineProps<{ conflicts: JointEditConflict[]; choices: JointConflictChoice[] }>();
const emit = defineEmits<{ 'update:choices': [choices: JointConflictChoice[]] }>();
const choiceOptions = [
  { label: '保留当前磁盘', value: 'disk' },
  { label: '采用本窗口修改', value: 'draft' },
];
function choose(index: number, choice: 'disk' | 'draft') {
  emit(
    'update:choices',
    props.conflicts.map((conflict, current) => ({
      recordKey: conflict.recordKey,
      path: [...conflict.path],
      choice: current === index ? choice : props.choices[current]!.choice,
    })),
  );
}
</script>
<style scoped>
.joint-conflict-list {
  max-height: 60vh;
  overflow: auto;
  display: grid;
  gap: var(--space-3);
}
.joint-conflict-row {
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.joint-conflict-row strong {
  overflow-wrap: anywhere;
}
.joint-conflict-row dl {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--space-2);
}
.joint-conflict-row dd {
  margin: 0;
  min-width: 0;
}
.joint-conflict-row pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
