import { createApp, h, type Component } from 'vue';
import WindowShell from '@/app/WindowShell.vue';
import BrowserWindowLocation from './BrowserWindowLocation.vue';
import { workspaceClient, clientWindowLabel } from './workspace-client';
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
  const bridge = workspaceClient();
  const titles = {
    'code-editor': '代码编辑器',
    editor: 'Spec 编辑器',
    'text-editor': '文本编辑器',
    'immersive-editor': '沉浸式编辑器',
    'weapon-fire-preview': '开火预览',
  };
  const shell =
    bootstrap.kind === 'main'
      ? { mode: 'main' as const }
      : {
          title: titles[bootstrap.context.kind],
          appearance: bootstrap.context.kind === 'immersive-editor' ? ('immersive' as const) : ('application' as const),
        };
  const app = createApp({
    render: () =>
      h(WindowShell, shell, {
        default: () => [h(Root), ...(bridge ? [h(BrowserWindowLocation, { runtime: bridge, label: clientWindowLabel() })] : [])],
      }),
  }).use(pinia);
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
  if (bootstrap.kind === 'main') return (await import('@/app/AppContent.vue')).default;
  switch (bootstrap.context.kind) {
    case 'code-editor':
      return (await import('@/app/components/code-editor/CodeEditorContent.vue')).default;
    case 'editor':
      return (await import('@/app/SpecEditorContent.vue')).default;
    case 'text-editor':
      return (await import('@/app/TextEditorContent.vue')).default;
    case 'immersive-editor':
      return (await import('@/app/ImmersiveEditorContent.vue')).default;
    case 'weapon-fire-preview':
      return (await import('@/app/WeaponFirePreviewContent.vue')).default;
  }
}
