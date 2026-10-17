<template>
  <div class="immersive-editor-shell ui-content-grid ui-text-normal" :class="{ 'variant-window-shell': compact }" :inert="locked">
    <main class="immersive-editor-scroll ui-layout-contained ui-layout-clip ui-control-reset">
      <div v-if="loading" class="immersive-status"><ImmersiveText text="正在读取联合来源" /></div>
      <div v-else-if="error" class="immersive-status">
        <strong><ImmersiveText text="读取失败" /></strong>
        <p><ImmersiveText :text="error" block /></p>
        <n-button @click="$emit('retry')">重试</n-button>
      </div>
      <slot v-else />
    </main>
    <footer v-if="!compact" class="immersive-editor-actions ui-footer ui-layout-row ui-layout-center">
      <ImmersiveEditorActions
        :dirty="dirty"
        :can-undo="canUndo"
        :can-redo="canRedo"
        :saving="saving"
        :ready="ready"
        @undo="$emit('undo')"
        @redo="$emit('redo')"
        @save="$emit('save')"
        @close="$emit('close')"
      >
        <template #before>
          <n-button v-if="externalNotice" size="small" @click="$emit('load-external')">载入外部版本</n-button>
        </template>
        <span role="status">{{ saving ? '保存中' : dirty ? '未保存' : '已保存' }}</span></ImmersiveEditorActions
      >
    </footer>
  </div>
</template>
<script setup lang="ts">
import ImmersiveText from './ImmersiveText.vue';
import ImmersiveEditorActions from './ImmersiveEditorActions.vue';
defineProps<{
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
