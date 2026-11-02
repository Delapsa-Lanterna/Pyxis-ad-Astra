<template>
  <div class="associated-save-dialog dialog-body">
    <p>勾选要一起保存的关联文件。</p>
    <div v-for="{ candidate, weaponCreate } in items" :key="candidate.key" class="associated-save-item dialog-body">
      <n-checkbox :checked="selectedKeys.has(candidate.key)" @update:checked="emit('select', candidate.key, $event)">{{
        candidate.label
      }}</n-checkbox>
      <template v-if="candidate.preparation">
        <template v-if="candidate.change.action === 'delete'">
          <p>
            <code>{{ candidate.preparation.target.write.path }}</code>
          </p>
        </template>
        <template v-else>
          <p>保存到：</p>
          <p>
            <code>{{ candidate.preparation.destination.location.path }}</code>
          </p>
          <p v-if="candidate.preparation.destination.version.fingerprint && candidate.preparation.destination.problem">
            {{ candidate.preparation.destination.problem }}
          </p>
          <p v-if="resolutionOptions(candidate).length > 1">处理方式</p>
          <n-select
            v-if="resolutionOptions(candidate).length > 1"
            :value="candidate.mode"
            :disabled="!selectedKeys.has(candidate.key)"
            :options="resolutionOptions(candidate)"
            aria-label="处理方式"
            @update:value="setMode(candidate.key, $event)"
          />
          <p
            v-if="
              candidate.mode !== 'read' && candidate.preparation.original?.version.fingerprint && !candidate.preparation.original.problem
            "
          >
            内容来自：<br /><code>{{ candidate.preparation.original.location.path }}</code>
          </p>
          <p v-if="candidate.preparation.original?.problem">
            <code>{{ candidate.preparation.original.location.path }}</code
            ><br />{{ candidate.preparation.original.problem }}
          </p>
          <p>
            {{
              candidate.mode === 'read'
                ? '读取目标文件，保留它的现有内容。'
                : candidate.preparation.original?.version.fingerprint && !candidate.preparation.original.problem
                  ? '使用原文件内容写入目标文件。'
                  : '使用默认模板重新创建目标文件。'
            }}
          </p>
          <p v-if="candidate.mode !== 'read' && candidate.preparation.destination.version.fingerprint">目标文件的现有内容将被覆盖。</p>
          <p v-if="removesOriginal(candidate)">
            同步更新 CSV，保存后移除旧文件：<br /><code>{{ candidate.preparation.original!.location.path }}</code>
          </p>
        </template>
      </template>
      <template v-if="weaponCreate">
        <p>武器分支</p>
        <n-select
          :value="weaponCreate.specClass"
          :options="weaponOptions"
          aria-label="武器分支"
          :disabled="!selectedKeys.has(candidate.key)"
          @update:value="setWeaponClass(candidate.key, $event)"
        />
      </template>
    </div>
    <p>本次保存 CSV 和 {{ selectedKeys.size }} 个关联文件，并支持一次撤销。</p>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { WEAPON_SPEC_CLASSES } from '@/domain/entity-write/spec-construction';
import type { AssociatedSpecCandidate } from '@/domain/csv-editor/associated-spec-candidates';
import type { WeaponSpecClass } from '@/shared/types';
import { normalizeFsPath } from '@/shared/lib/paths';

const props = defineProps<{ candidates: AssociatedSpecCandidate[]; selectedKeys: Set<string> }>();
const emit = defineEmits<{ select: [key: string, checked: boolean]; 'update:candidates': [candidates: AssociatedSpecCandidate[]] }>();
const weaponOptions = WEAPON_SPEC_CLASSES.map((value) => ({ label: value === 'projectile' ? '弹体武器' : '光束武器', value }));
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
      label: prepared.original?.version.fingerprint && !prepared.original.problem ? '使用原文件内容' : '使用默认模板',
      value: 'overwrite',
    },
  ];
  if (prepared.destination.version.fingerprint && !prepared.destination.problem)
    options.unshift({ label: '采用目标现有内容', value: 'read' });
  return options;
}
function removesOriginal(candidate: AssociatedSpecCandidate) {
  const original = candidate.preparation!.original;
  return (
    candidate.change.action === 'rename' &&
    original?.location.source === 'mod' &&
    original.version.fingerprint &&
    normalizeFsPath(original.location.path) !== normalizeFsPath(candidate.preparation!.destination.location.path)
  );
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
