import { createBrowserHost } from './host';
import {
  createScenario,
  scenarios,
  scenarioHref,
  workspaceEntries,
  sampleLabels,
  until,
  sampleSelector,
  performanceScenarios,
  type ScenarioOptions,
} from './scenarios/registry';
import { listen, eventListenerCount } from './runtime/events';
import { createBrowserWorkspace, workspaceClient } from './workspace-runtime';
import WorkspaceShell from './WorkspaceShell.vue';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { useSettingsStore } from '@/stores/settings.store';
import type { AppSettings } from '@/shared/types';
import { installNaiveUi } from '@/app/naive-ui.runtime';
import { initializeSettings } from '@/orchestrators/settings-persistence.orchestrator';
import { initializeSettingsStore } from '@/stores/settings.store';
import { startApplicationLog } from '@/app/application-log';
import { startPerformanceMonitor } from '@/app/performance-monitor';
import { initializeWindowContext } from '@/windows/window-context.window';
import { showCurrentWindow } from '@/windows/current.window';
import { listen as listenWindowEvent } from './runtime/native';
import appIcon from '@/assets/app-icon.svg';
import { mountSceneAppearance } from './appearance';
import { mountBrowserHeader } from './header';
import '@/styles/style.css';
import './browser.css';

const query = new URLSearchParams(location.search);
Object.assign(globalThis, {
  browserScenarios: scenarios.map((scene) => ({ ...scene, href: scenarioHref(scene.id) })),
  browserWorkspaceEntries: workspaceEntries,
});
const icon = document.createElement('link');
icon.rel = 'icon';
icon.href = appIcon;
document.head.append(icon);
document.title = query.has('scene') ? '前端场景预览' : query.has('window') ? '应用子窗口 · 浏览器验收' : '前端测试工作区';
if (!query.has('scene') && !query.has('window')) {
  document.body.classList.add('browser-preview-layout');
  const controls = document.querySelector<HTMLElement>('#controls')!;
  controls.replaceChildren();
  const workspace = createBrowserWorkspace(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  (window as Window & { browserWorkspace?: typeof workspace }).browserWorkspace = workspace;
  createApp(WorkspaceShell, { workspace }).mount('#app');
  void workspaceWindows();
  if (query.has('navigation')) void navigateInitial(workspace, query.get('navigation')!);
  if (query.has('page')) void navigateGlobal(query.get('page')!);
  if (query.has('sampleWindow')) {
    const kinds = {
      'spec-window': 'editor',
      'file-window': 'file-editor',
      'immersive-window': 'immersive-editor',
      'preview-window': 'weapon-fire-preview',
    } as const;
    void workspace.openSampleWindow(kinds[query.get('sampleWindow') as keyof typeof kinds]);
  }
} else {
  document.body.dataset.workspaceBridge = String(Boolean(workspaceClient()));
  void workspaceWindows().catch((error) => {
    const output = document.createElement('pre');
    const workspace = workspaceClient();
    output.textContent =
      (error instanceof Error ? (error.stack ?? error.message) : String(error)) +
      '\n' +
      JSON.stringify(workspace?.calls.slice(-5)) +
      '\n' +
      JSON.stringify([...(workspace?.windows.keys() ?? [])]);
    document.querySelector('#app')?.replaceChildren(output);
  });
}
async function navigateInitial(workspace: ReturnType<typeof createBrowserWorkspace>, id: string) {
  const item = workspace.navigation.find((entry) => entry.id === id)!;
  const frame = () => document.querySelector<HTMLIFrameElement>('iframe[data-window="main"]')!.contentDocument!;
  await until(() => Boolean(frame()?.querySelector('.mod-card-actions button')), '工作区入口');
  frame().querySelector<HTMLButtonElement>('.mod-card-actions button')!.click();
  const button = () =>
    [...frame().querySelectorAll<HTMLButtonElement>('.mod-navigation-button')].find(
      (entry) => entry.querySelector('.mod-navigation-button-label')!.textContent === item.label,
    );
  await until(() => Boolean(button()), item.label);
  button()!.click();
}
async function navigateGlobal(page: string) {
  const frame = () => document.querySelector<HTMLIFrameElement>('iframe[data-window="main"]')!.contentDocument!;
  await until(() => Boolean(frame()?.querySelector('[aria-label="工作区菜单"]')), '工作区菜单');
  frame().querySelector<HTMLButtonElement>('[aria-label="工作区菜单"]')!.click();
  const item = () =>
    [...frame().querySelectorAll<HTMLButtonElement>('.titlebar-workspace-menu button')].find(
      (button) => button.textContent?.trim() === (page === 'settings' ? '设置' : '关于'),
    );
  await until(() => Boolean(item()), '全局页面');
  item()!.click();
}
async function workspaceWindows() {
  const windowLabel = query.get('window');
  if (windowLabel) {
    const bootstrap = await initializeWindowContext();
    const [Root, settings] = await Promise.all([loadRoot(bootstrap), initializeSettings()]);
    initializeSettingsStore(settings.value);
    const pinia = createPinia();
    const settingsStore = useSettingsStore(pinia);
    await startApplicationLog(pinia);
    startPerformanceMonitor(pinia, settings.performanceMonitorActive);
    const app = createApp(Root).use(pinia);
    installNaiveUi(app);
    app.mount('#app');
    if (windowLabel === 'main')
      await listenWindowEvent('browser-appearance-request', ({ payload }) => {
        const appearance = payload as Partial<Pick<AppSettings, 'theme' | 'accent' | 'customAccent'>>;
        if (appearance.theme) settingsStore.setTheme(appearance.theme);
        if (appearance.accent) settingsStore.setAccent(appearance.accent);
        if (appearance.customAccent) settingsStore.setCustomAccent(appearance.customAccent);
      });
    await showCurrentWindow();
    return;
  }
  if (!query.has('scene')) return;
  await startScene();
}
async function loadRoot(bootstrap: Awaited<ReturnType<typeof initializeWindowContext>>): Promise<import('vue').Component> {
  if (bootstrap.kind === 'main') return (await import('@/app/App.vue')).default;
  switch (bootstrap.context.kind) {
    case 'editor':
      return (await import('@/app/SpecEditorApp.vue')).default;
    case 'file-editor':
      return (await import('@/app/FileEditorApp.vue')).default;
    case 'immersive-editor':
      return (await import('@/app/ImmersiveEditorApp.vue')).default;
    case 'weapon-fire-preview':
      return (await import('@/app/WeaponFirePreviewApp.vue')).default;
  }
  return (await import('@/app/App.vue')).default;
}
async function startScene() {
  const definition = scenarios.find((scene) => scene.id === query.get('scene'))!;
  document.body.classList.add('browser-preview', 'browser-preview-layout');
  const controls = document.querySelector<HTMLElement>('#controls')!;
  controls.className = 'browser-controls browser-chrome';
  controls.innerHTML =
    '<div id="browser-header"></div><div class="testbed-actions"><a href="/">完整测试工作区</a><details class="workbench-menu workbench-catalog"><summary>场景目录</summary><nav class="workbench-menu-panel workbench-catalog-panel">' +
    scenarios.map((item) => '<a href="' + scenarioHref(item.id) + '">' + item.label + '</a>').join('') +
    '</nav></details><label ' +
    (definition.samples.length === 1 ? 'hidden' : '') +
    '>样本 <select id="sample" aria-label="场景样本">' +
    definition.samples.map((id) => '<option value="' + id + '">' + (sampleLabels[id] ?? performanceLabel(id)) + '</option>').join('') +
    '</select></label><label ' +
    (definition.id !== 'pickers' ? 'hidden' : '') +
    '>来源 <select id="source" aria-label="候选来源"><option value="mod">本 Mod</option><option value="core">原版</option><option value="all">全部来源</option></select></label><label ' +
    (!['csv', 'pickers'].includes(definition.id) ? 'hidden' : '') +
    '>规模 <input id="count" type="number" min="2" value="' +
    (query.get('count') ?? (definition.id === 'csv' ? 50 : 30)) +
    '"></label><button id="reopen">重新打开</button><button id="reset">恢复样本</button>' +
    '<button id="close">关闭场景</button><div id="appearance"></div><span id="status" role="status">正在准备</span></div>';
  const element = document.querySelector<HTMLElement>('#app')!;
  const status = document.querySelector<HTMLElement>('#status')!;
  mountBrowserHeader(
    document.querySelector<HTMLElement>('#browser-header')!,
    definition.label,
    controls.querySelector<HTMLElement>('.testbed-actions')!,
    status,
  );
  const host = createBrowserHost(element);
  let appearance: ReturnType<typeof mountSceneAppearance> | undefined;
  const options: ScenarioOptions = {
    scene: definition.samples[0]!,
    count: 30,
    resourceSize: 0,
    monitor: false,
    theme: (query.get('theme') as ScenarioOptions['theme']) ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  };
  async function show(reset = false) {
    delete status.dataset.ready;
    controls.querySelectorAll<HTMLButtonElement>('button').forEach((button) => (button.disabled = true));
    try {
      appearance?.unmount();
      options.count = Number(document.querySelector<HTMLInputElement>('#count')!.value);
      options.scene = document.querySelector<HTMLSelectElement>('#sample')!.value as ScenarioOptions['scene'];
      options.source = document.querySelector<HTMLSelectElement>('#source')!.value as ScenarioOptions['source'];
      const model = reset || !host.model ? createScenario(options) : host.model;
      if (query.has('readFailure')) model.failures.set('query_joint_edit', '样本来源读取失败，请重试');
      await host.open(model);
      await until(() => Boolean(element.querySelector(sampleSelector(options.scene))), definition.label);
      appearance = mountSceneAppearance(document.querySelector<HTMLElement>('#appearance')!, host);
      appearance.mount('#appearance');
      status.textContent = definition.operations.join(' · ');
      status.dataset.ready = 'true';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      status.dataset.ready = 'false';
    } finally {
      controls.querySelectorAll<HTMLButtonElement>('button').forEach((button) => (button.disabled = false));
    }
  }
  document.querySelector<HTMLButtonElement>('#reopen')!.onclick = () => void show();
  document.querySelector<HTMLButtonElement>('#reset')!.onclick = () => void show(true);
  document.querySelector<HTMLSelectElement>('#sample')!.onchange = () => void show(true);
  document.querySelector<HTMLSelectElement>('#source')!.onchange = () => void show(true);
  async function close() {
    appearance?.unmount();
    appearance = undefined;
    await host.close();
    status.textContent = '已关闭';
    status.dataset.ready = 'false';
  }
  document.querySelector<HTMLButtonElement>('#close')!.onclick = () => void close();
  void listen('browser-close', close);
  Object.assign(globalThis, { browserTest: { host, eventListenerCount } });
  void show();
}
function performanceLabel(id: ScenarioOptions['scene']) {
  return performanceScenarios.find((item) => item.id === id)?.label ?? id;
}
