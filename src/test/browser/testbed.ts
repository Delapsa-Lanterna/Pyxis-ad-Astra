import type { Benchmark } from './benchmarks/runner';
import { performanceScenarios } from '../../../scripts/browser/scenarios.mjs';
import { showResults, downloadReport } from './results';
import type { RunOptions, RunResult } from './contracts';
import { comparePages, type Variant } from './benchmarks/comparison';
import { markdown } from '../../../scripts/browser/report.mjs';
import { mountSceneAppearance, browserThemeStyle } from './appearance';
import { mountBrowserHeader } from './header';
import appIcon from '@/assets/app-icon.svg';
import '@/styles/style.css';
import './browser.css';

document.body.classList.add('browser-benchmark');
document.title = '星界罗盘 · 性能测试台';
const icon = document.createElement('link');
icon.rel = 'icon';
icon.href = appIcon;
document.head.append(icon);
const controls = document.querySelector<HTMLElement>('#controls')!;
controls.className = 'testbed browser-chrome';
controls.innerHTML =
  '<div id="browser-header"></div><section class="testbed-controls"><span id="status" role="status">就绪</span>' +
  '<div class="testbed-parameters"><label>场景<select id="scene">' +
  performanceScenarios.map((scene) => '<option value="' + scene.id + '">' + scene.label + '</option>').join('') +
  '</select></label><label>负载<select id="workload"><option value="benchmark">基准</option><option value="stress">重复使用压力</option><option value="resources">资源压力</option></select></label>' +
  '<label>规模<input id="count" type="number" min="2" value="50"></label><label>预热<input id="warmup" type="number" min="0" value="2"></label>' +
  '<label>测量轮数<input id="rounds" type="number" min="1" value="30"></label><label>资源规模<select id="size"><option value="0">轻量</option><option>32</option><option>128</option><option>512</option></select></label>' +
  '<label class="testbed-toggle ui-control-row"><input id="monitor" type="checkbox">性能监视</label></div><div class="testbed-actions">' +
  '<button id="preview">显示样本</button><button id="run">运行选中场景</button><button id="lists">列表基准</button><button id="stress">重复使用压力</button>' +
  '<button id="json">导出 JSON</button><button id="md">导出 Markdown</button><div id="appearance"></div></div></section>' +
  '<details class="testbed-section testbed-results"><summary>执行结果与交替比较</summary>' +
  '<div class="testbed-detail-panel"><section class="ui-layout-shrink"><h2>交替比较</h2><div id="variants"></div><div class="testbed-actions"><button id="add-variant">添加比较组</button><button id="compare">交替比较</button>' +
  '<button id="aa">同对象双组对照</button><button id="monitor-compare">监视开销对照</button></div></section><section class="ui-layout-shrink"><h2>执行结果</h2><pre id="results">选择场景并运行后显示结果。</pre></section></div></details>';
const status = document.querySelector<HTMLElement>('#status')!;
mountBrowserHeader(
  document.querySelector<HTMLElement>('#browser-header')!,
  '性能测试台',
  controls.querySelector<HTMLElement>('.testbed-actions')!,
  status,
);
const results = document.querySelector<HTMLElement>('#results')!;
let benchmark: Benchmark;
async function loadBenchmark() {
  benchmark ??= (await import('./benchmarks/runner')).createBenchmark(document.querySelector<HTMLElement>('#app')!);
  return benchmark;
}
let appearance: ReturnType<typeof mountSceneAppearance> | undefined;
const initialTheme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
for (const [key, value] of Object.entries(browserThemeStyle({ theme: initialTheme, accent: 'blue', customAccent: '#2563eb' })))
  controls.style.setProperty(key, String(value));
let runs: RunResult[] = [];
let report: { pass: boolean; runs: RunResult[]; [key: string]: unknown } = { pass: true, runs };
const number = (id: string) => Number(document.querySelector<HTMLInputElement>('#' + id)!.value);
const selected = (): RunOptions => ({
  scene: document.querySelector<HTMLSelectElement>('#scene')!.value as RunOptions['scene'],
  count: number('count'),
  resourceSize: number('size'),
  workload: document.querySelector<HTMLSelectElement>('#workload')!.value as RunOptions['workload'],
  warmup: number('warmup'),
  rounds: number('rounds'),
  monitor: document.querySelector<HTMLInputElement>('#monitor')!.checked,
  theme: benchmark?.host.model ? benchmark.host.settings.theme : initialTheme,
  accent: benchmark?.host.model ? benchmark.host.settings.accent : 'blue',
  customAccent: benchmark?.host.model ? benchmark.host.settings.customAccent : '#2563eb',
});
async function execute(options: RunOptions[]) {
  appearance?.unmount();
  delete status.dataset.complete;
  controls.querySelector<HTMLDetailsElement>('.testbed-results')!.open = false;
  controls.querySelectorAll<HTMLButtonElement>('button').forEach((button) => (button.disabled = true));
  runs = [];
  try {
    await loadBenchmark();
    for (const option of options) {
      runs.push(await benchmark.run(option, (text) => (status.textContent = text)));
      report = showResults(results, runs);
    }
    status.textContent = runs.every((run) => run.pass) ? '通过' : '失败，查看执行结果';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    if (benchmark) mountAppearance();
    status.dataset.complete = 'true';
    controls.querySelectorAll<HTMLButtonElement>('button').forEach((button) => (button.disabled = false));
  }
}
document.querySelector<HTMLButtonElement>('#run')!.onclick = () => void execute([selected()]);
document.querySelector<HTMLButtonElement>('#lists')!.onclick = () =>
  void execute(
    performanceScenarios.flatMap(({ id: scene, counts }) =>
      counts.map((count) => ({ ...selected(), scene, count, workload: 'benchmark' })),
    ),
  );
document.querySelector<HTMLButtonElement>('#stress')!.onclick = () =>
  void execute(
    performanceScenarios.map(({ id: scene }) => ({
      ...selected(),
      scene,
      count: scene === 'csv' ? 50 : 30,
      workload: 'stress',
      rounds: 100,
    })),
  );
document.querySelector<HTMLSelectElement>('#workload')!.onchange = () => {
  document.querySelector<HTMLInputElement>('#rounds')!.value = selected().workload === 'stress' ? '100' : '30';
  document.querySelector<HTMLSelectElement>('#size')!.value = selected().workload === 'resources' ? '32' : '0';
  const scene = document.querySelector<HTMLSelectElement>('#scene')!;
  scene.disabled = selected().workload === 'resources';
  if (scene.disabled) scene.value = 'weapons';
};
async function preview() {
  controls.querySelector<HTMLDetailsElement>('.testbed-results')!.open = false;
  status.textContent = '正在准备样本';
  try {
    await loadBenchmark();
    const { createScenario } = await import('./scenarios/registry');
    appearance?.unmount();
    await benchmark.host.open(createScenario(selected()), selected().monitor);
    mountAppearance();
    status.textContent = '样本已显示';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
}
function mountAppearance() {
  appearance = mountSceneAppearance(document.querySelector<HTMLElement>('#appearance')!, benchmark.host);
  appearance.mount('#appearance');
}
document.querySelector<HTMLButtonElement>('#preview')!.onclick = () => void preview();
for (const format of ['json', 'md'] as const)
  document.querySelector<HTMLButtonElement>('#' + format)!.onclick = () => downloadReport(report, format);
const variantsInput = document.querySelector<HTMLElement>('#variants')!;
function addVariant() {
  const row = document.createElement('fieldset');
  row.className = 'testbed-variant ui-control-border';
  row.innerHTML =
    '<label>组名 <input class="variant-label" value="' +
    String.fromCharCode(65 + variantsInput.children.length) +
    '"></label>' +
    '<label>测试台地址 <input class="variant-url" type="url" value="' +
    location.origin +
    '"></label>' +
    '<label><input class="variant-monitor" type="checkbox">开启性能监视</label>' +
    '<label>判定 <select class="variant-policy"><option value="code">记录性能差异</option><option value="enabled">监视开启预算</option><option value="disabled">监视关闭预算</option></select></label>' +
    '<button type="button">移除</button>';
  row.querySelector('button')!.onclick = () => row.remove();
  variantsInput.append(row);
}
addVariant();
addVariant();
document.querySelector<HTMLButtonElement>('#add-variant')!.onclick = addVariant;
async function compareSelected(variants: Variant[]) {
  delete status.dataset.complete;
  const options = selected();
  appearance?.unmount();
  controls.querySelectorAll<HTMLButtonElement>('button').forEach((button) => (button.disabled = true));
  try {
    await benchmark?.host.close();
    report = await comparePages(variants, options, (text) => (status.textContent = text));
    runs = report.runs;
    results.textContent = markdown(report);
    status.textContent = report.pass ? '对照通过' : '对照失败，查看执行结果';
    Object.assign(globalThis, { testbedComparison: report });
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    if (benchmark) mountAppearance();
    controls.querySelectorAll<HTMLButtonElement>('button').forEach((button) => (button.disabled = false));
    status.dataset.complete = 'true';
  }
}
document.querySelector<HTMLButtonElement>('#compare')!.onclick = () =>
  void compareSelected(
    [...variantsInput.children].map((row) => ({
      label: row.querySelector<HTMLInputElement>('.variant-label')!.value,
      url: row.querySelector<HTMLInputElement>('.variant-url')!.value,
      monitor: row.querySelector<HTMLInputElement>('.variant-monitor')!.checked,
      policy: row.querySelector<HTMLSelectElement>('.variant-policy')!.value as Variant['policy'],
    })),
  );
document.querySelector<HTMLButtonElement>('#aa')!.onclick = () =>
  void compareSelected(['A', 'B'].map((label) => ({ label, url: location.origin, monitor: false, policy: 'code' })));
document.querySelector<HTMLButtonElement>('#monitor-compare')!.onclick = () =>
  void compareSelected(
    [false, true].map((monitor) => ({ label: monitor ? 'enabled' : 'disabled', url: location.origin, monitor, policy: 'enabled' })),
  );
if (new URLSearchParams(location.search).has('worker')) {
  async function handleRequest(event: MessageEvent) {
    if (event.source !== parent || event.data.type !== 'testbed-request') return;
    const { id, method, options, iteration, phase, samples } = event.data;
    try {
      await loadBenchmark();
      const value =
        method === 'sample'
          ? await benchmark.sampleRound(options, iteration, phase)
          : benchmark.summarizeRun(options, samples, await benchmark.environment());
      parent.postMessage({ type: 'testbed-result', id, value }, event.origin);
    } catch (error) {
      parent.postMessage({ type: 'testbed-result', id, error: String(error) }, event.origin);
    }
  }
  window.addEventListener('message', (event) => void handleRequest(event));
  parent.postMessage({ type: 'testbed-ready' }, '*');
}
Object.assign(globalThis, {
  testbed: {
    sampleRound: async (...args: Parameters<Benchmark['sampleRound']>) => (await loadBenchmark()).sampleRound(...args),
    environment: async () => (await loadBenchmark()).environment(),
    summarizeRun: async (...args: Parameters<Benchmark['summarizeRun']>) => (await loadBenchmark()).summarizeRun(...args),
    get host() {
      return benchmark?.host;
    },
  },
});
