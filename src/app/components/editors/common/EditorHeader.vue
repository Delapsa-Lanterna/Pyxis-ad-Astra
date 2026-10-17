<template>
  <header class="editor-header page-header ui-layout-row ui-content-surface">
    <div class="page-identity ui-layout-grid ui-layout-shrink">
      <div class="editor-title-row ui-control-row">
        <h1 class="page-title ui-text-reset ui-layout-shrink ui-text-wrap ui-text-normal">{{ title }}</h1>
        <span v-if="readonly" class="ui-readonly-status ui-text-muted ui-layout-inline ui-layout-center">只读播放</span>
        <span
          v-else
          class="ui-status ui-text-muted ui-layout-inline ui-layout-center"
          :class="{ dirty, saving, warning: Boolean(externalUpdateNotice) }"
          role="status"
          ><i class="ui-status-indicator" />{{ saving ? '保存中' : dirty ? '有未保存修改' : '已保存' }}</span
        >
      </div>
      <p v-if="path" class="page-path ui-text-truncate ui-text-muted ui-text-reset" :title="path">{{ path }}</p>
    </div>
    <div v-if="$slots.actions" class="editor-actions ui-control-row"><slot name="actions" /></div>
    <div v-if="$slots.default" class="editor-tools ui-layout-shrink"><slot /></div>
    <div v-if="externalUpdateNotice" class="ui-notice">
      <span>{{ externalUpdateNotice }}</span
      ><n-button size="tiny" @click="$emit('load-external')">载入外部版本</n-button>
    </div>
  </header>
</template>
<script setup lang="ts">
defineProps<{
  title: string;
  path?: string;
  dirty?: boolean;
  saving?: boolean;
  readonly?: boolean;
  externalUpdateNotice?: string;
}>();
defineEmits<{ 'load-external': [] }>();
</script>
