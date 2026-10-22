/* eslint-disable vue/one-component-per-file -- The benchmark owns isolated application providers. */
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import { createPinia } from 'pinia';
import { NConfigProvider, NMessageProvider, NDialogProvider, useMessage, useDialog } from 'naive-ui';
import { useCsvEditorActions } from '@/app/composables/csv-editor/use-csv-editor-actions';
import CsvEditorWorkspace from '@/app/components/csv-editor/CsvEditorWorkspace.vue';
import VariantPicker from '@/app/components/immersive/variant/VariantPicker.vue';
import VariantHullmodPicker from '@/app/components/immersive/variant/VariantHullmodPicker.vue';
import { projectVariantPanel } from '@/domain/immersive/variant/variant-panel';
import { installNaiveUi } from '@/app/naive-ui.runtime';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { provideAppFeedback } from '@/app/composables/use-app-feedback';
import { createAppFeedback } from '@/app/app-feedback';
import { provideWindowCloseState } from '@/app/composables/use-window-close-state';
import { provideOriginalFonts } from '@/app/composables/use-original-fonts';
import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { fixture, prepareFixture } from './retained-lists.fixture';
import { startPerformanceMonitor } from '@/app/performance-monitor';
import SettingsPage from '@/app/components/SettingsPage.vue';
import '@/styles/style.css';

type Kind = 'csv' | 'weapons' | 'wings' | 'hullmods';
let app: App | null = null;
let stopMonitor: (() => void) | undefined;
let tables: ReturnType<typeof useCsvEditorStore>;
const controls = document.querySelector<HTMLElement>('#controls')!;
controls.innerHTML = '<button id="run">运行全部基准</button> <button id="preview">显示样本</button><pre id="status">Ready</pre>';
controls.style.cssText = 'height:68px;overflow:auto;padding:8px;box-sizing:border-box';
document.querySelector<HTMLElement>('#app')!.style.cssText = 'height:calc(100vh - 68px);position:relative';
const status = document.querySelector<HTMLElement>('#status')!;
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
async function settled() {
  await nextTick();
  await frame();
  await frame();
}
const panel = () => document.querySelector<HTMLElement>('.table-panel,.variant-picker-list,.variant-hullmod-list')!;
const rowSelector = (kind: Kind) => (kind === 'csv' ? '.csv-grid-row[data-row-key]' : '[data-entry-id]');
async function mount(kind: Kind, count: number, session: string) {
  app?.unmount();
  stopMonitor?.();
  prepareFixture(count, kind, session);
  const Body = defineComponent({
    setup() {
      const feedback = createAppFeedback(useMessage(), useDialog(), () => []);
      provideAppFeedback(feedback);
      const actions = useCsvEditorActions(feedback);
      provideWindowCloseState({
        requestClose: async () => ({ status: 'closed', destroyedWindows: [], releasedSessions: [], diagnostic: null }),
        replyClose: async () => {},
        readyClose: async () => {},
        prepareDisplay: () => async () => {},
        flushSettings: async () => {},
        clearConfig: async () => {},
        reload: async () => {},
      });
      provideFieldInputs(createFieldInputs(ref(session)));
      provideOriginalFonts(() => session);
      tables = useCsvEditorStore();
      const workspace = useWorkspaceStore();
      workspace.registerMod({ modRoot: 'M:/benchmark', displayName: 'Benchmark', version: '', status: 'ready' });
      useProjectStore().registerProjectManifest(fixture.manifest);
      tables.initializeModTables({ sessionId: session, modRoot: 'M:/benchmark', manifest: fixture.manifest });
      workspace.activateModTable('M:/benchmark');
      const variant = projectVariantPanel(fixture.snapshot, {}).variants[0]!;
      return () =>
        new URLSearchParams(location.search).get('case') === 'settings'
          ? h(SettingsPage, { closeWorkspace: async () => true })
          : kind === 'csv'
            ? h(CsvEditorWorkspace, { detailPaneExpanded: false, actions })
            : kind === 'hullmods'
              ? h(VariantHullmodPicker, { root: fixture.snapshot.root, variant })
              : h(VariantPicker, {
                  root: fixture.snapshot.root,
                  kind,
                  currentId: '',
                  anchor: { x: 430, y: 350 },
                  weaponSlot: { type: 'BALLISTIC', size: 'MEDIUM' },
                  commitManual: async () => true,
                });
    },
  });
  const Root = defineComponent({
    setup: () => () =>
      h(
        NConfigProvider,
        { style: 'height:100%;min-height:0;display:flex;flex-direction:column' },
        { default: () => h(NMessageProvider, null, { default: () => h(NDialogProvider, null, { default: () => h(Body) }) }) },
      ),
  });
  app = createApp(Root);
  const pinia = createPinia();
  stopMonitor = startPerformanceMonitor(pinia, new URLSearchParams(location.search).get('monitor') === 'on');
  app.use(pinia);
  const settings = createSettingsFixture({
    theme: 'light',
    editMode: 'plain',
    immersiveGameFont: true,
    performanceMonitorEnabled: new URLSearchParams(location.search).get('monitor') === 'on',
  });
  initializeSettingsStore(settings);
  initializeCacheLimits(settings.cacheLimits);
  installNaiveUi(app);
  const started = performance.now();
  app.mount('#app');
  if (new URLSearchParams(location.search).get('case') !== 'settings') while (!document.querySelector(rowSelector(kind))) await frame();
  await settled();
  return performance.now() - started;
}
function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    min: sorted[0],
    max: sorted.at(-1),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}
async function sampleRound(kind: Kind, count: number, iteration: number) {
  const values: Record<string, number[]> = {};
  const sample = (name: string, value: number) => (values[name] ??= []).push(value);
  const rowHeight = kind === 'csv' ? 24 : kind === 'hullmods' ? 36 : 78;
  status.textContent = `${kind} ${count}: ${iteration + 1}/30`;
  sample('open', await mount(kind, count, `${kind}-${count}-${iteration}`));
  const element = panel();
  const first =
    kind === 'csv' ? element.querySelector<HTMLElement>('[data-row-key="ships:row:0"]') : element.querySelector(rowSelector(kind));
  const started = performance.now();
  const longTasks: PerformanceEntry[] = [];
  const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries()));
  observer.observe({ type: 'longtask' });
  let observing = true,
    previous = performance.now();
  const observe = (time: number) => {
    if (!observing) return;
    sample('frame', time - previous);
    previous = time;
    requestAnimationFrame(observe);
  };
  requestAnimationFrame(observe);
  for (const position of [count / 2, count - 20, 0, count - 20, 0]) {
    element.scrollTop = position * rowHeight;
    element.dispatchEvent(new Event('scroll'));
    await settled();
  }
  sample('roundTrip', performance.now() - started);
  const currentFirst =
    kind === 'csv' ? element.querySelector<HTMLElement>('[data-row-key="ships:row:0"]') : element.querySelector(rowSelector(kind));
  sample('firstNodeRetained', Number(first === currentFirst));
  const traversal = performance.now();
  const step = Math.max(1, Math.floor(element.clientHeight / rowHeight));
  for (let position = 0; position < count; position += step) {
    element.scrollTop = position * rowHeight;
    element.dispatchEvent(new Event('scroll'));
    await nextTick();
    await frame();
  }
  element.scrollTop = 0;
  element.dispatchEvent(new Event('scroll'));
  await settled();
  sample('traverse', performance.now() - traversal);
  observing = false;
  longTasks.push(...observer.takeRecords());
  observer.disconnect();
  sample('longTaskCount', longTasks.length);
  sample(
    'longTaskTime',
    longTasks.reduce((total, task) => total + task.duration, 0),
  );
  sample('longTaskMax', Math.max(0, ...longTasks.map((task) => task.duration)));
  sample('mountedRows', element.querySelectorAll(rowSelector(kind)).length);
  if (kind === 'csv') {
    const row = element.querySelector<HTMLElement>('[data-row-key]')!;
    const cell = row.querySelector<HTMLElement>('[data-column-key="id"]')!;
    const activate = performance.now();
    cell.click();
    await settled();
    sample('activate', performance.now() - activate);
    const input = element.querySelector<HTMLInputElement>('input');
    if (input) {
      const started = performance.now();
      input.value += '_edited';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await settled();
      sample('input', performance.now() - started);
      input.dispatchEvent(new Event('blur'));
    }
    sample('reads', fixture.reads);
    sample('selected', Number(Boolean(tables.selectedRowKey)));
  }
  const close = performance.now();
  app!.unmount();
  stopMonitor?.();
  app = null;
  await settled();
  sample('close', performance.now() - close);
  return values;
}
Object.assign(globalThis, { retainedBenchmark: { sampleRound, summarize } });
async function run(kind: Kind, count: number) {
  const values: Record<string, number[]> = {};
  for (let iteration = 0; iteration < 30; iteration++)
    for (const [name, samples] of Object.entries(await sampleRound(kind, count, iteration))) (values[name] ??= []).push(...samples);
  const report = { kind, count, metrics: Object.fromEntries(Object.entries(values).map(([name, samples]) => [name, summarize(samples)])) };
  await fetch('/results', { method: 'POST', body: JSON.stringify(report) });
  return report;
}
document.querySelector<HTMLButtonElement>('#run')!.onclick = async (event) => {
  (event.currentTarget as HTMLButtonElement).disabled = true;
  const reports = [];
  const selected = new URLSearchParams(location.search).get('case');
  for (const [kind, count] of [
    ['csv', 50],
    ['csv', 300],
    ['csv', 2000],
    ['weapons', 30],
    ['weapons', 100],
    ['weapons', 800],
    ['wings', 30],
    ['wings', 100],
    ['wings', 800],
    ['hullmods', 30],
    ['hullmods', 100],
    ['hullmods', 800],
  ] as const) {
    if (selected && selected !== kind + '-' + count) continue;
    try {
      reports.push(await run(kind, count));
    } catch (error) {
      const report = { kind, count, error: String(error) };
      reports.push(report);
      await fetch('/results', { method: 'POST', body: JSON.stringify(report) });
    }
  }
  status.textContent = JSON.stringify(reports);
  status.dataset.complete = 'true';
};
document.querySelector<HTMLButtonElement>('#preview')!.onclick = () => {
  const selected = new URLSearchParams(location.search).get('case');
  void mount('csv', Number(selected?.split('-')[1] ?? 2000), 'preview');
};
