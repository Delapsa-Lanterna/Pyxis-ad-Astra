<template>
  <button
    class="immersive-square-toggle ui-button ui-control-button ui-control-reset"
    :class="{ fallback: !textured }"
    :role="role"
    :aria-checked="checked"
    :aria-label="label"
    :title="title"
    @click="$emit('change', $event)"
  >
    <img
      class="ui-image immersive-square-toggle-image"
      :src="checked ? (textured ? onImage : localOn) : textured ? offImage : localOff"
      alt=""
      aria-hidden="true"
    />
  </button>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import localOn from '@/assets/immersive/controls/toggle-on.svg';
import localOff from '@/assets/immersive/controls/toggle-off.svg';
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
