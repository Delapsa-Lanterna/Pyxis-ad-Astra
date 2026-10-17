<template>
  <div class="immersive-filter-group ui-layout-row" :aria-label="label">
    <ImmersiveFilterToggle
      v-for="option in displayed"
      :key="option.value ?? 'all'"
      :checked="checked(option.value)"
      :label="option.label"
      :text="option.label + ' (' + option.count + ')'"
      :style="{ width: textWidth(option.label + ' (' + option.count + ')') + 40 + 'px' }"
      @toggle="toggle(option.value, $event)"
    />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { HullmodFilterOption } from '@/domain/immersive/variant/variant-hullmods';
import { toggleHullmodFilter } from '@/domain/immersive/variant/variant-hullmods';
import { useFontMeasurement } from '@/app/composables/use-original-fonts';
import { immersiveFontIds } from '@/domain/immersive/font-roles';
import ImmersiveFilterToggle from './ImmersiveFilterToggle.vue';
const props = defineProps<{ options: HullmodFilterOption[]; label: string; total: number; modelValue: string[] | null }>();
const emit = defineEmits<{ 'update:modelValue': [value: string[] | null] }>();
const displayed = computed(() => [{ value: null, label: props.label, count: props.total }, ...props.options]);
const checked = (value: string | null) =>
  value === null ? props.modelValue === null : props.modelValue === null || props.modelValue.includes(value);
const measureText = useFontMeasurement(immersiveFontIds.body);
const textWidth = (text: string) => measureText([{ text }]);
function toggle(value: string | null, event: MouseEvent) {
  emit('update:modelValue', toggleHullmodFilter(props.modelValue, props.options, value, event.ctrlKey || event.shiftKey));
}
</script>
