import { nextTick } from 'vue';
import { createBrowserHost } from './host';
import { createBrowserModel } from './model';
import { summarize } from '../../../scripts/shared/sample-statistics.mjs';
type Kind = 'csv' | 'weapons' | 'wings' | 'hullmods';
const controls = document.querySelector<HTMLElement>('#controls')!;
document.body.classList.add('browser-benchmark');
controls.innerHTML =
  '<button id="run">运行全部基准</button> <button id="smoke">单轮流程检查</button> <button id="preview">显示样本</button><pre id="status">Ready</pre>';
const element = document.querySelector<HTMLElement>('#app')!;
const host = createBrowserHost(element);
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
  const monitor = new URLSearchParams(location.search).get('monitor') === 'on';
  const model = createBrowserModel(kind, count, session);
  model.saveSettings({ ...model.settings, theme: 'light', editMode: 'plain', immersiveGameFont: true, performanceMonitorEnabled: monitor });
  const started = await host.open(model, monitor);
  while (!document.querySelector(rowSelector(kind))) await frame();
  await settled();
  return performance.now() - started;
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
    const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('.csv-cell-editor input,.csv-cell-text-editor textarea');
    if (!input) throw new Error('CSV 激活后未出现活动输入');
    const started = performance.now();
    input.value += '_edited';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settled();
    sample('input', performance.now() - started);
    input.dispatchEvent(new Event('blur'));
    sample('reads', host.model.reads);
    sample('selected', Number(Boolean(host.tables.selectedRowKey)));
  }
  const close = performance.now();
  host.unmount();
  await settled();
  sample('close', performance.now() - close);
  await host.close();
  return values;
}
Object.assign(globalThis, { retainedBenchmark: { sampleRound, summarize } });
async function run(kind: Kind, count: number) {
  const values: Record<string, number[]> = {};
  for (let iteration = 0; iteration < 30; iteration++)
    for (const [name, samples] of Object.entries(await sampleRound(kind, count, iteration))) (values[name] ??= []).push(...samples);
  const report = {
    kind,
    count,
    environment: await environment(),
    samples: values,
    metrics: Object.fromEntries(Object.entries(values).map(([name, samples]) => [name, summarize(samples)])),
  };
  await fetch('/results', { method: 'POST', body: JSON.stringify(report) });
  return report;
}
async function environment() {
  return {
    ...(await fetch('/environment').then((response) => response.json())),
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    cache: 'new scene; shared module and font cache',
    profiler: false,
  };
}
document.querySelector<HTMLButtonElement>('#smoke')!.onclick = async () => {
  const selected = new URLSearchParams(location.search).get('case') ?? 'csv-50';
  const kind = selected.split('-')[0] as Kind;
  const samples = await sampleRound(kind, Number(selected.split('-')[1] ?? 30), 0);
  status.textContent = JSON.stringify({ smoke: true, environment: await environment(), samples });
  status.dataset.complete = 'true';
};
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
  const kind = (selected?.split('-')[0] ?? 'csv') as Kind;
  void mount(kind, Number(selected?.split('-')[1] ?? (kind === 'csv' ? 50 : 30)), 'preview');
};
