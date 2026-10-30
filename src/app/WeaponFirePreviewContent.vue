<template>
  <div
    class="app-frame editor-window-app ui-content-contained ui-layout-grid ui-layout-clip ui-layout-stretch ui-text-normal"
    :data-theme="settings.theme"
  >
    <div v-if="!contentReady && loading" class="editor-window-status ui-text-muted ui-layout-grid ui-layout-stretch">
      <strong class="editor-window-status-value ui-emphasis ui-text-normal">正在加载</strong><span>{{ target.id }}</span>
    </div>
    <div
      v-else-if="!contentReady && errorText"
      class="editor-window-status editor-window-error ui-text-muted ui-layout-grid ui-layout-stretch"
    >
      <strong class="editor-window-status-value editor-window-error-value ui-emphasis ui-text-normal">加载失败</strong
      ><span class="editor-window-error-label">{{ errorText }}</span>
      <n-button @click="reloadCurrentWindow">重试</n-button>
    </div>
    <WeaponFirePreview
      v-else-if="data"
      :session-id="data.sessionId"
      :weapon-id="target.id"
      :weapon-csv-row="data.weaponCsvRow"
      :weapon-spec="data.weapon"
      :projectile="data.projectile"
      :resources="data.resources"
      @close="closeWindow"
    />
  </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useSettingsStore } from '@/stores/settings.store';
import { useDirtyWindowCloseGuard } from '@/app/composables/use-dirty-window-close-guard';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { closeCurrentWindow, reloadCurrentWindow } from '@/windows/current.window';
import WeaponFirePreview from '@/app/components/weapon-fire-preview/WeaponFirePreview.vue';
import { useWeaponFirePreviewWindowViewModel } from '@/app/composables/weapon-fire-preview/use-weapon-fire-preview-window-view-model';
const settings = useSettingsStore();
const feedback = useAppFeedback();
const { target, data, loading, errorText, contentReady, dispose } = useWeaponFirePreviewWindowViewModel();
const closeGuard = useDirtyWindowCloseGuard({ dirty: ref(false), title: '关闭开火预览？', content: '关闭开火预览窗口。' });
function closeWindow() {
  void closeCurrentWindow().catch((error) => feedback.error(error, '关闭窗口失败'));
}
useShortcutDispatch({ commands: { close: closeWindow } });
onMounted(async () => {
  await closeGuard.install();
});
onUnmounted(() => {
  closeGuard.dispose();
  dispose();
});
</script>
