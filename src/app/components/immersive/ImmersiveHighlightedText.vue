<template>
  <p class="immersive-custom-text">
    <ImmersiveText :runs="parts.map((part) => ({ text: part.text, color: part.highlight ? '#ffd200' : undefined }))" block />
  </p>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { highlightedTextParts } from '@/domain/immersive/highlighted-text';
import ImmersiveText from './ImmersiveText.vue';
const props = defineProps<{ text: string; highlights: string }>();
const parts = computed(() => highlightedTextParts(props.text, props.highlights));
</script>
