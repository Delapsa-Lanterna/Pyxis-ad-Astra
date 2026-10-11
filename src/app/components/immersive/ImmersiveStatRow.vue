<template>
  <div class="immersive-stat-row" :class="stat.tone ?? 'highlight'">
    <span>{{ stat.label }}</span>
    <n-popover
      v-if="editable && stat.fields.length"
      trigger="click"
      placement="bottom-end"
      display-directive="if"
      :show="active"
      @update:show="$emit('toggle', $event)"
      :show-arrow="false"
    >
      <template #trigger
        ><button type="button" class="immersive-stat-value" :title="stat.diagnostic || stat.formula || '点击编辑来源参数'">
          {{ stat.display }}
        </button></template
      >
      <ImmersiveFieldPopover
        :stat="stat"
        :values="values"
        :snapshot="snapshot"
        :runtime-context="runtimeContext"
        :active="active"
        @update="(field, update) => $emit('update', field, update)"
        @close="$emit('dismiss')"
      />
    </n-popover>
    <strong v-else class="immersive-stat-value" :title="stat.diagnostic || stat.formula">{{ stat.display }}</strong>
  </div>
</template>
<script setup lang="ts">
import type { ImmersiveStat, ImmersiveField } from '@/domain/immersive/fields';
import type { JointEditSnapshot, JointValue } from '@/shared/types';
import type { SchemaFieldUpdate } from '@/domain/schema/schema.types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import ImmersiveFieldPopover from './ImmersiveFieldPopover.vue';
defineProps<{
  stat: ImmersiveStat;
  editable: boolean;
  active: boolean;
  values: Record<string, JointValue>;
  snapshot: JointEditSnapshot;
  runtimeContext: SchemaRuntimeContext;
}>();
defineEmits<{ toggle: [show: boolean]; dismiss: []; update: [field: ImmersiveField, update: SchemaFieldUpdate] }>();
</script>
