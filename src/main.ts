import { createApp, type App, type Component } from 'vue';
import { createPinia } from 'pinia';
import { installNaiveUi } from '@/app/naive-ui.runtime';
import { initializeSettings } from '@/orchestrators/settings-persistence.orchestrator';
import { recordLogBestEffort } from '@/services/app-log.service';
import { startPerformanceMonitor } from '@/app/performance-monitor';
import { errorDiagnosticOf } from '@/shared/lib/errors';
import { startApplicationLog } from '@/app/application-log';
import { installRuntimeErrorMonitor, installVueErrorHandlers } from '@/app/runtime-error-monitor';
import { initializeSettingsStore } from '@/stores/settings.store';
import { showCurrentWindow } from '@/windows/current.window';
import { initializeWindowContext, failWindowStartup } from '@/windows/window-context.window';
import StartupFailure from '@/app/StartupFailure.vue';
import './styles/style.css';

let app: App | null = null;
let pageActive = true;
window.addEventListener(
  'pagehide',
  () => {
    pageActive = false;
  },
  { once: true },
);
installRuntimeErrorMonitor();
async function bootstrap() {
  const bootstrap = await initializeWindowContext();
  if (!pageActive) return;
  const windowKind = bootstrap.kind === 'main' ? 'main' : bootstrap.context.kind;
  const [Root, settings] = await Promise.all([loadWindowRoot(windowKind), initializeSettings()]);
  if (!pageActive) return;
  initializeSettingsStore(settings.value);
  const pinia = createPinia();
  await startApplicationLog(pinia);
  if (!pageActive) return;
  startPerformanceMonitor(pinia, settings.performanceMonitorActive);
  app = createApp(Root).use(pinia);
  installVueErrorHandlers(app);
  installNaiveUi(app);
  app.mount('#app');
  await showCurrentWindow();
}

async function loadWindowRoot(kind: string | null): Promise<Component> {
  switch (kind) {
    case 'file-editor':
      return (await import('@/app/FileEditorApp.vue')).default;
    case 'editor':
      return (await import('@/app/SpecEditorApp.vue')).default;
    case 'weapon-fire-preview':
      return (await import('@/app/WeaponFirePreviewApp.vue')).default;
    case 'immersive-editor':
      return (await import('@/app/ImmersiveEditorApp.vue')).default;
    default:
      return (await import('@/app/App.vue')).default;
  }
}

void bootstrap().catch((error) => {
  if (!pageActive) return;
  app?.unmount();
  const reported = failWindowStartup(error).catch(reportStartupError);
  const target = document.querySelector('#app');
  if (target) {
    app = createApp(StartupFailure, { error, reported, onFailure: reportStartupError });
    installVueErrorHandlers(app);
    app.mount(target);
  }
  void showCurrentWindow().catch(reportStartupError);
});

function reportStartupError(error: unknown) {
  if (!pageActive) return;
  const diagnostic = errorDiagnosticOf(error);
  recordLogBestEffort({
    level: 'error',
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.location?.path ?? null,
    line: diagnostic.location?.line ?? null,
    fields: { action: 'window-startup-report' },
  });
}
