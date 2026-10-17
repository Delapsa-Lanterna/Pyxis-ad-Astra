<template>
  <NCollapse class="schema-form" v-bind="$attrs" arrow-placement="right" display-directive="show">
    <template v-for="(_, slot) in $slots" :key="slot" #[slot]="scope"><slot :name="slot" v-bind="scope ?? {}" /></template>
    <template #arrow="scope">
      <slot name="arrow" v-bind="scope">
        <svg class="section-chevron-icon ui-control-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" /></svg>
      </slot>
    </template>
  </NCollapse>
</template>
<script setup lang="ts">
import { NCollapse } from 'naive-ui/es/collapse';
defineOptions({ inheritAttrs: false });
</script>
