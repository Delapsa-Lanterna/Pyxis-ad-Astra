<template>
  <div class="schema-field" :class="{ 'field-group': layout === 'group', 'field-readonly': readonly }" :data-field-path="path ?? fieldKey">
    <slot name="label"><FieldLabel :label="label" :field-key="fieldKey" :path="path" :required="required" /></slot>
    <div class="field-control">
      <div class="field-control-line"><slot /><slot name="actions" /></div>
      <slot name="hint" />
    </div>
  </div>
</template>
<script setup lang="ts">
import FieldLabel from '@/shared/ui/FieldLabel.vue';
withDefaults(
  defineProps<{ label?: string; fieldKey?: string; path?: string; layout?: 'row' | 'group'; readonly?: boolean; required?: boolean }>(),
  {
    layout: 'row',
    readonly: false,
    label: undefined,
    fieldKey: undefined,
    path: undefined,
    required: false,
  },
);
</script>
