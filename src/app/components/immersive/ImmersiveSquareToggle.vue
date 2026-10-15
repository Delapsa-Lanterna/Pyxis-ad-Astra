<template>
  <button
    class="immersive-square-toggle"
    :class="{ fallback: !textured }"
    :role="role"
    :aria-checked="checked"
    :aria-label="label"
    :title="title"
    @click="$emit('change', $event)"
  >
    <img v-if="textured" :src="checked ? onImage : offImage" alt="" aria-hidden="true" />
  </button>
</template>
<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{
  checked: boolean;
  label: string;
  title: string;
  role: 'checkbox' | 'radio';
  onImage: string;
  offImage: string;
}>();
const textured = computed(() => Boolean(props.onImage && props.offImage));
defineEmits<{ change: [event: MouseEvent] }>();
</script>
