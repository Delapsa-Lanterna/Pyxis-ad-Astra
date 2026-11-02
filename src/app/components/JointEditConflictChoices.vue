<template>
  <div class="joint-conflict-list">
    <p>共有 {{ conflicts.length }} 处内容需要选择。</p>
    <section
      v-for="(conflict, index) in conflicts"
      :key="JSON.stringify([conflict.recordKey, conflict.path])"
      class="joint-conflict-row ui-control-border"
    >
      <code>{{ sourcePath(conflict.recordKey) }}</code>
      <strong>字段：{{ conflict.path.join('.') || '整条记录' }}</strong>
      <span>采用内容</span>
      <n-select :value="choices[index]?.choice" :options="choiceOptions" aria-label="采用内容" @update:value="choose(index, $event)" />
      <strong>将保存</strong>
      <pre class="joint-conflict-row-code ui-code ui-text-wrap ui-text-reset">{{
        valueText(choices[index]?.choice === 'draft' ? conflict.draft : conflict.disk)
      }}</pre>
      <n-collapse>
        <n-collapse-item title="查看三份完整内容" name="sources">
          <div class="dialog-body">
            <template
              v-for="(value, label) in { 打开时: conflict.baseline, 磁盘当前内容: conflict.disk, 本次编辑: conflict.draft }"
              :key="label"
            >
              <strong>{{ label }}</strong>
              <pre class="joint-conflict-row-code ui-code ui-text-wrap ui-text-reset">{{ valueText(value) }}</pre>
            </template>
          </div>
        </n-collapse-item>
      </n-collapse>
    </section>
  </div>
</template>
<script setup lang="ts">
import type { JointEditConflict, JointConflictChoice, JointEditRecord, JointValue } from '@/shared/types';
import { conflictValueText } from '@/domain/joint-edit';
const props = withDefaults(defineProps<{ conflicts: JointEditConflict[]; choices: JointConflictChoice[]; records?: JointEditRecord[] }>(), {
  records: () => [],
});
const emit = defineEmits<{ 'update:choices': [choices: JointConflictChoice[]] }>();
const choiceOptions = [
  { label: '磁盘当前内容', value: 'disk' },
  { label: '本次编辑', value: 'draft' },
];
function sourcePath(key: string) {
  const record = props.records.find((record) => record.key === key);
  return record ? (record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path) : key;
}
function valueText(value: JointValue) {
  return value.state === 'missing' ? '此字段已删除' : value.value === '' ? '空字符串' : conflictValueText(value);
}
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
