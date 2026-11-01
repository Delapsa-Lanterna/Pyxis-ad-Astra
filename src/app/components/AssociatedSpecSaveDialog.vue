<template>
  <div class="associated-save-dialog">
    <p>勾选的关联 spec 动作随 CSV 一次保存并支持撤销；取消勾选时仅保存 CSV。</p>
    <div class="associated-save-list">
      <div v-for="{ candidate, weaponCreate } in items" :key="candidate.key" class="associated-save-item">
        <n-checkbox :checked="selectedKeys.has(candidate.key)" @update:checked="emit('select', candidate.key, $event)">
          {{ candidate.label }}
        </n-checkbox>
        <template v-if="candidate.preparation && candidate.change.action !== 'delete'">
          <div class="ui-text-small ui-text-wrap">目标文件：{{ candidate.preparation.destination.location.path }}</div>
          <div v-if="candidate.preparation.original" class="ui-text-small ui-text-wrap">
            原文件：{{ candidate.preparation.original.location.path }}
          </div>
          <div v-if="candidate.preparation.original?.problem" class="ui-text-small ui-text-wrap">
            原文件：{{ candidate.preparation.original.problem }}
          </div>
          <div
            v-if="candidate.preparation.destination.version.fingerprint && candidate.preparation.destination.problem"
            class="ui-text-small ui-text-wrap"
          >
            目标文件：{{ candidate.preparation.destination.problem }}
          </div>
          <n-select
            :value="candidate.mode"
            :disabled="!selectedKeys.has(candidate.key)"
            :options="resolutionOptions(candidate)"
            @update:value="setMode(candidate.key, $event)"
          />
          <div
            v-if="candidate.change.action === 'rename' && candidate.preparation.original?.location.source === 'mod'"
            class="ui-text-small"
          >
            保存后移除原文件
          </div>
        </template>
        <n-select
          v-if="weaponCreate"
          :value="weaponCreate.specClass"
          :options="weaponOptions"
          :disabled="!selectedKeys.has(candidate.key)"
          @update:value="setWeaponClass(candidate.key, $event)"
        />
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { WEAPON_SPEC_CLASSES } from '@/domain/entity-write/spec-construction';
import type { AssociatedSpecCandidate } from '@/domain/csv-editor/associated-spec-candidates';
import type { WeaponSpecClass } from '@/shared/types';

const props = defineProps<{ candidates: AssociatedSpecCandidate[]; selectedKeys: Set<string> }>();
const emit = defineEmits<{ select: [key: string, checked: boolean]; 'update:candidates': [candidates: AssociatedSpecCandidate[]] }>();
const weaponOptions = WEAPON_SPEC_CLASSES.map((value) => ({ label: value, value }));
const items = computed(() =>
  props.candidates.map((candidate) => ({
    candidate,
    weaponCreate:
      candidate.change.action !== 'delete' &&
      candidate.change.create.kind === 'weapon' &&
      candidate.mode !== 'read' &&
      !(candidate.preparation?.original?.version.fingerprint && !candidate.preparation.original.problem)
        ? candidate.change.create
        : null,
  })),
);
function resolutionOptions(candidate: AssociatedSpecCandidate) {
  const prepared = candidate.preparation!;
  const options = [
    {
      label:
        (prepared.destination.version.fingerprint ? '覆盖目标，' : '') +
        (prepared.original?.version.fingerprint && !prepared.original.problem ? '使用原文件内容' : '使用默认模板重建'),
      value: 'overwrite',
    },
  ];
  if (prepared.destination.version.fingerprint && !prepared.destination.problem)
    options.unshift({ label: '读取已有文件，保留其内容', value: 'read' });
  return options;
}
function setMode(key: string, mode: 'read' | 'overwrite') {
  emit(
    'update:candidates',
    props.candidates.map((candidate) => (candidate.key === key ? { ...candidate, mode } : candidate)),
  );
}
function setWeaponClass(key: string, specClass: WeaponSpecClass) {
  emit(
    'update:candidates',
    props.candidates.map((candidate) =>
      candidate.key === key && candidate.change.action !== 'delete' && candidate.change.create.kind === 'weapon'
        ? { ...candidate, change: { ...candidate.change, create: { ...candidate.change.create, specClass } } }
        : candidate,
    ),
  );
}
</script>
