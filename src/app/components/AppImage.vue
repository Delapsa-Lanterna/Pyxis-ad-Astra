<template><NImage v-bind="$attrs" object-fit="contain" :preview-disabled="closing || previewDisabled" /></template>
<script setup lang="ts">
import { NImage } from 'naive-ui/es/image';
import { useWindowCloseState } from '@/app/composables/use-window-close-state';
defineOptions({ inheritAttrs: false });
withDefaults(defineProps<{ previewDisabled?: boolean }>(), { previewDisabled: false });
const closing = useWindowCloseState();
</script>
