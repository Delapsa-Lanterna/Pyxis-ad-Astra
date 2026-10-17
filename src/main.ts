import { createApp, type Component } from 'vue';
import { createPinia } from 'pinia';
import { installNaiveUi } from '@/app/naive-ui.runtime';
import { initializeSettings } from '@/orchestrators/settings-persistence.orchestrator';
import { startPerformanceLogSink, recordLogBestEffort } from '@/services/app-log.service';
import { errorDiagnosticOf } from '@/shared/lib/errors';
import { initializeSettingsStore } from '@/stores/settings.store';
import { showCurrentWindow, reloadCurrentWindow } from '@/windows/current.window';
import { initializeWindowContext, failWindowStartup } from '@/windows/window-context.window';
import './styles/style.css';

async function bootstrap() {
  const bootstrap = await initializeWindowContext();
  const windowKind = bootstrap.kind === 'main' ? 'main' : bootstrap.context.kind;
  const stopLog = startPerformanceLogSink();
  window.addEventListener('pagehide', stopLog, { once: true });
  const [Root, settings] = await Promise.all([loadWindowRoot(windowKind), initializeSettings()]);
  initializeSettingsStore(settings.value);
  const pinia = createPinia();
  const app = createApp(Root).use(pinia);
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
  void failWindowStartup(error).catch((error) => {
    const diagnostic = errorDiagnosticOf(error);
    recordLogBestEffort({
      level: 'error',
      code: diagnostic.code,
      message: diagnostic.message,
      path: diagnostic.location?.path ?? null,
      line: diagnostic.location?.line ?? null,
      fields: { action: 'window-startup-report' },
    });
  });
  const target = document.querySelector('#app');
  if (target) {
    const message = error instanceof Error ? error.message : String(error);
    target.innerHTML = `<div class="startup-error"><h1 class="page-title">启动失败</h1><pre class="startup-error-code">${escapeHtml(message)}</pre><button id="startup-retry">重试</button></div>`;
    target.querySelector('#startup-retry')?.addEventListener('click', reloadCurrentWindow);
  }
  void showCurrentWindow();
});

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char] ?? char;
  });
}
