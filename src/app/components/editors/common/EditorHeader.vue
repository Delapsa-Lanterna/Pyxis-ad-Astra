<template>
  <header class="editor-header ui-layout-row ui-layout-center ui-content-surface">
    <div class="editor-title ui-layout-grid ui-layout-shrink">
      <strong class="editor-title-value ui-emphasis ui-text-reset ui-text-normal">{{ title }}</strong>
      <span class="editor-title-label ui-text-truncate ui-text-path ui-text-muted ui-text-small">{{ subtitle }}</span>
    </div>
    <div
      class="editor-draft-status ui-text-muted ui-text-small ui-layout-inline ui-layout-center"
      :class="{ dirty, external: Boolean(externalUpdateNotice) }"
    >
      <span>{{ statusText }}</span>
      <button
        class="ui-button editor-draft-status-button ui-text-normal ui-control-pointer ui-content-surface-muted"
        v-if="externalUpdateNotice"
        type="button"
        @click="$emit('load-external')"
      >
        载入外部版本
      </button>
    </div>
    <slot />
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ title: string; subtitle: string; dirty?: boolean; externalUpdateNotice?: string }>();
defineEmits<{ 'load-external': [] }>();

const statusText = computed(() => props.externalUpdateNotice || (props.dirty ? '未保存' : '已保存'));
</script>
