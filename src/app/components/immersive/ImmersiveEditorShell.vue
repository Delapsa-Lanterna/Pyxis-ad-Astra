<template>
  <div class="immersive-editor-shell" :class="{ 'variant-window-shell': compact }" :inert="locked">
    <header v-if="!compact" class="immersive-window-header">
      <strong><ImmersiveText :text="title" :font="compact ? 'caption' : 'heading'" /></strong>
      <span><ImmersiveText :text="saving ? '保存中' : dirty ? '未保存' : '已保存'" /></span>
      <n-button v-if="externalNotice" size="small" @click="$emit('load-external')">载入外部版本</n-button>
    </header>
    <main class="immersive-editor-scroll">
      <div v-if="loading" class="immersive-status"><ImmersiveText text="正在读取联合来源" /></div>
      <div v-else-if="error" class="immersive-status">
        <strong><ImmersiveText text="读取失败" /></strong>
        <p><ImmersiveText :text="error" block /></p>
        <n-button @click="$emit('retry')">重试</n-button>
      </div>
      <slot v-else />
    </main>
    <footer v-if="!compact" class="immersive-editor-actions">
      <ImmersiveEditorActions
        :can-undo="canUndo"
        :can-redo="canRedo"
        :saving="saving"
        :ready="ready"
        @undo="$emit('undo')"
        @redo="$emit('redo')"
        @save="$emit('save')"
        @close="$emit('close')"
      />
    </footer>
  </div>
</template>
<script setup lang="ts">
import ImmersiveText from './ImmersiveText.vue';
import ImmersiveEditorActions from './ImmersiveEditorActions.vue';
defineProps<{
  title: string;
  dirty: boolean;
  saving: boolean;
  loading: boolean;
  error: string;
  ready: boolean;
  locked: boolean;
  externalNotice: string;
  canUndo: boolean;
  canRedo: boolean;
  compact?: boolean;
}>();
defineEmits<{ save: []; close: []; undo: []; redo: []; retry: []; 'load-external': [] }>();
</script>
