<template>
  <NSelect ref="select" v-bind="$attrs" :filterable="filterable" :show="show ?? open" @update:show="updateShow" @click.capture="click">
    <template v-for="(_, slot) in $slots" :key="slot" #[slot]="scope"><slot :name="slot" v-bind="scope ?? {}" /></template>
  </NSelect>
</template>
<script setup lang="ts">
import { ref, useTemplateRef } from 'vue';
import { NSelect, type SelectInst } from 'naive-ui/es/select';
defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{ show?: boolean; filterable?: boolean }>(), { show: undefined, filterable: false });
const emit = defineEmits<{ 'update:show': [show: boolean] }>();
const open = ref(false);
const select = useTemplateRef<SelectInst>('select');
function updateShow(show: boolean) {
  open.value = show;
  emit('update:show', show);
}
function click(event: MouseEvent) {
  if (!(props.show ?? open.value)) return;
  const target = event.target as Element;
  if (target.closest('.n-base-suffix__arrow')) {
    event.stopPropagation();
    updateShow(false);
  } else if (!props.filterable && !target.closest('.n-base-clear, .n-tag__close')) {
    event.stopPropagation();
    select.value!.focus();
  }
}
defineExpose({
  focus: () => select.value!.focus(),
  blur: () => select.value!.blur(),
  focusInput: () => select.value!.focusInput(),
  blurInput: () => select.value!.blurInput(),
});
</script>
