<template>
  <div class="joint-conflict-list ui-layout-grid">
    <section
      v-for="(conflict, index) in conflicts"
      :key="JSON.stringify([conflict.recordKey, conflict.path])"
      class="joint-conflict-row ui-control-border"
    >
      <strong class="joint-conflict-row-value ui-emphasis ui-text-wrap"
        >{{ conflict.recordKey }} / {{ conflict.path.join('.') || '整条记录' }}</strong
      >
      <dl class="joint-conflict-row-details ui-layout-grid">
        <dt>原基线</dt>
        <dd class="joint-conflict-row-detail ui-layout-shrink ui-text-reset">
          <pre class="joint-conflict-row-code ui-code ui-text-wrap ui-text-reset">{{ conflictValueText(conflict.baseline) }}</pre>
        </dd>
        <dt>当前磁盘</dt>
        <dd class="joint-conflict-row-detail ui-layout-shrink ui-text-reset">
          <pre class="joint-conflict-row-code ui-code ui-text-wrap ui-text-reset">{{ conflictValueText(conflict.disk) }}</pre>
        </dd>
        <dt>本窗口</dt>
        <dd class="joint-conflict-row-detail ui-layout-shrink ui-text-reset">
          <pre class="joint-conflict-row-code ui-code ui-text-wrap ui-text-reset">{{ conflictValueText(conflict.draft) }}</pre>
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
