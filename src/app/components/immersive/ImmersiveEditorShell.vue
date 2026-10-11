<template>
  <div class="immersive-editor-shell" :inert="locked">
    <header class="immersive-window-header">
      <strong><ImmersiveText :text="title" font="heading" /></strong>
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
    <footer class="immersive-editor-actions">
      <div>
        <n-button :disabled="!canUndo || saving" @click="$emit('undo')">撤销</n-button
        ><n-button :disabled="!canRedo || saving" @click="$emit('redo')">重做</n-button
        ><n-button :loading="saving" :disabled="!ready" type="primary" @click="$emit('save')">保存</n-button
        ><n-button @click="$emit('close')">关闭</n-button>
      </div>
    </footer>
  </div>
</template>
<script setup lang="ts">
import ImmersiveText from './ImmersiveText.vue';
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
}>();
defineEmits<{ save: []; close: []; undo: []; redo: []; retry: []; 'load-external': [] }>();
</script>
