<template>
  <FontText
    class="immersive-text"
    :font="immersiveFontIds[font]"
    :text="text"
    :runs="runs"
    :block="block"
    :ink-aligned="inkAligned"
    :outlined="outlined"
    :active="active"
  />
</template>
<script setup lang="ts">
import FontText from '@/app/components/fonts/FontText.vue';
import { immersiveFontIds, type ImmersiveFontRole } from '@/domain/immersive/font-roles';
import type { TextRun } from '@/domain/fonts/font.types';

withDefaults(
  defineProps<{
    text?: string;
    runs?: readonly TextRun[];
    font?: ImmersiveFontRole;
    block?: boolean;
    inkAligned?: boolean;
    outlined?: boolean;
    active?: boolean;
  }>(),
  {
    text: '',
    runs: undefined,
    font: 'body',
    block: false,
    inkAligned: false,
    outlined: false,
    active: true,
  },
);
</script>
