<template>
  <button
    class="immersive-square-toggle"
    :role="role"
    :aria-checked="checked"
    :aria-label="label"
    :title="title"
    @click="$emit('change', $event)"
  >
    <img v-if="checked ? onImage : offImage" :src="checked ? onImage : offImage" alt="" aria-hidden="true" />
  </button>
</template>
<script setup lang="ts">
defineProps<{ checked: boolean; label: string; title: string; role: 'checkbox' | 'radio'; onImage: string; offImage: string }>();
defineEmits<{ change: [event: MouseEvent] }>();
</script>
