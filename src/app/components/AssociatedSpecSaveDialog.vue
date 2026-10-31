<template>
  <div class="associated-save-dialog">
    <p>勾选的关联 spec 动作随本次 CSV 一起保存，并形成一次文件历史。武器类型用于新建及重命名来源缺失时的创建。</p>
    <div class="associated-save-list">
      <div v-for="{ candidate, weaponCreate } in items" :key="candidate.key" class="associated-save-item">
        <n-checkbox :checked="selectedKeys.has(candidate.key)" @update:checked="emit('select', candidate.key, $event)">
          {{ candidate.label }}
        </n-checkbox>
        <n-select
          v-if="weaponCreate"
          :value="weaponCreate.specClass"
          :options="weaponOptions"
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
    weaponCreate: candidate.change.action !== 'delete' && candidate.change.create.kind === 'weapon' ? candidate.change.create : null,
  })),
);
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
