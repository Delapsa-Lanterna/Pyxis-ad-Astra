<template>
  <div class="app-frame editor-window-app" :data-theme="settings.theme">
    <div v-if="!contentReady && loading" class="editor-window-status">
      <strong>正在加载</strong><span>{{ target.id }}</span>
    </div>
    <div v-else-if="!contentReady && errorText" class="editor-window-status editor-window-error">
      <strong>加载失败</strong><span>{{ errorText }}</span>
    </div>
    <WeaponFirePreview
      v-else-if="data"
      :weapon-id="target.id"
      :weapon-csv-row="data.weaponCsvRow"
      :weapon-spec="data.weapon"
      :projectile-specs="data.projectileSpecs"
      :sprite-data="data.weaponSpriteData"
      @close="closeWindow"
    />
  </div>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useSettingsStore } from '@/stores/settings.store';
import { useDirtyWindowCloseGuard } from '@/app/composables/use-dirty-window-close-guard';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { closeCurrentWindow } from '@/windows/current.window';
import WeaponFirePreview from '@/app/components/weapon-fire-preview/WeaponFirePreview.vue';
import { useWeaponFirePreviewWindowViewModel } from '@/app/composables/weapon-fire-preview/use-weapon-fire-preview-window-view-model';
const settings = useSettingsStore();
const { target, data, loading, errorText, contentReady, initialize, dispose } = useWeaponFirePreviewWindowViewModel();
const closeGuard = useDirtyWindowCloseGuard({ dirty: ref(false), title: '关闭发射预览？', content: '关闭发射预览窗口。' });
function closeWindow() {
  void closeCurrentWindow();
}
useShortcutDispatch({ commands: { close: closeWindow } });
onMounted(async () => {
  await closeGuard.install();
  await initialize();
});
onUnmounted(() => {
  closeGuard.dispose();
  dispose();
});
</script>
