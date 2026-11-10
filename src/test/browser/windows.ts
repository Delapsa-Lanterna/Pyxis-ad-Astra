import { createApp, type Component } from 'vue';
import { createPinia } from 'pinia';
import { initializeWindowContext } from '@/windows/window-context.window';
import { showCurrentWindow } from '@/windows/current.window';
import { initializeSettings } from '@/orchestrators/settings-persistence.orchestrator';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { startApplicationLog } from '@/app/application-log';
import { flushApplicationLogs } from '@/services/app-log.service';
import { startPerformanceMonitor } from '@/app/performance-monitor';
import { installNaiveUi } from '@/app/naive-ui.runtime';
import { listen } from './runtime/native';
import type { AppSettings } from '@/shared/types';

export async function mountBrowserWindow() {
  const bootstrap = await initializeWindowContext();
  const [Root, settings] = await Promise.all([loadRoot(bootstrap), initializeSettings()]);
  initializeSettingsStore(settings.value);
  const pinia = createPinia(),
    settingsStore = useSettingsStore(pinia);
  await startApplicationLog(pinia);
  startPerformanceMonitor(pinia, settings.performanceMonitorActive);
  const app = createApp(Root).use(pinia);
  installNaiveUi(app);
  app.mount('#app');
  await listen('browser-measurement-ready', () => flushApplicationLogs());
  if (new URLSearchParams(location.search).get('window') === 'main')
    await listen('browser-appearance-request', ({ payload }) => {
      const appearance = payload as Partial<Pick<AppSettings, 'theme' | 'accent' | 'customAccent'>>;
      if (appearance.theme) settingsStore.setTheme(appearance.theme);
      if (appearance.accent) settingsStore.setAccent(appearance.accent);
      if (appearance.customAccent) settingsStore.setCustomAccent(appearance.customAccent);
    });
  await showCurrentWindow();
}
async function loadRoot(bootstrap: Awaited<ReturnType<typeof initializeWindowContext>>): Promise<Component> {
  if (bootstrap.kind === 'main') return (await import('@/app/App.vue')).default;
  switch (bootstrap.context.kind) {
    case 'code-editor':
      return (await import('@/app/CodeEditorApp.vue')).default;
    case 'editor':
      return (await import('@/app/SpecEditorApp.vue')).default;
    case 'text-editor':
      return (await import('@/app/TextEditorApp.vue')).default;
    case 'immersive-editor':
      return (await import('@/app/ImmersiveEditorApp.vue')).default;
    case 'weapon-fire-preview':
      return (await import('@/app/WeaponFirePreviewApp.vue')).default;
  }
}
