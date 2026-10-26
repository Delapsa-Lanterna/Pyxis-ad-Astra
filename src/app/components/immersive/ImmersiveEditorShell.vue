<template>
  <div class="immersive-editor-shell ui-content-grid ui-text-normal" :class="{ 'variant-window-shell': compact }" :aria-busy="preparing">
    <main class="immersive-editor-scroll ui-layout-contained ui-layout-clip ui-control-reset" :inert="locked || covered">
      <div v-if="!ready" class="immersive-editor-placeholder immersive-scene-grid">
        <header>
          <h1 class="page-title">{{ label }}编辑器</h1>
          <code class="ui-text-wrap">{{ objectId }}</code>
        </header>
      </div>
      <slot v-else />
    </main>
    <footer v-if="!compact" class="immersive-editor-actions ui-footer ui-layout-row ui-layout-center" :inert="locked || covered">
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
    <section v-if="covered" class="immersive-loading-overlay ui-layout-grid" :aria-label="`${label}准备状态`">
      <div class="immersive-loading-content ui-content-grid">
        <n-spin v-if="preparing" size="large" />
        <h1 class="page-title" role="status">{{ preparing ? `正在准备${label}` : `${label}准备失败` }}</h1>
        <p v-if="!preparing" class="immersive-loading-reason ui-text-reset" role="alert">{{ error }}</p>
        <p v-else-if="delayed" class="ui-text-reset" role="status">准备时间较长，请继续等待</p>
        <n-button v-if="!preparing" type="primary" @click="$emit('retry')">重试</n-button>
      </div>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue';
import { immersiveBlockedKey } from './immersive-render-context';
import ImmersiveEditorActions from './ImmersiveEditorActions.vue';
const props = defineProps<{
  label: string;
  objectId: string;
  targetKey: string;
  referenceChanging: boolean;
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
const preparing = computed(() => props.loading || props.referenceChanging || (!props.ready && !props.error));
const covered = computed(() => preparing.value || Boolean(props.error));
provide(
  immersiveBlockedKey,
  computed(() => props.locked || covered.value),
);
const delayed = ref(false);
watch(
  [preparing, () => props.targetKey],
  ([waiting], _, onCleanup) => {
    delayed.value = false;
    if (waiting) {
      const timer = setTimeout(() => {
        delayed.value = true;
        emit('slow');
      }, 12000);
      onCleanup(() => clearTimeout(timer));
    }
  },
  { immediate: true },
);
const emit = defineEmits<{ save: []; close: []; undo: []; redo: []; retry: []; slow: []; 'load-external': [] }>();
</script>
