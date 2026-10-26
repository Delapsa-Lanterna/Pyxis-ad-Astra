import { createBrowserHost } from './host';
import { createScenario, scenarios, until, type ScenarioOptions } from './scenarios/registry';
import { listen, eventListenerCount } from './runtime/events';

const query = new URLSearchParams(location.search);
const scene = (query.get('scene') ?? 'settings') as ScenarioOptions['scene'];
document.body.classList.add('browser-preview', 'browser-preview-layout');
const controls = document.querySelector<HTMLElement>('#controls')!;
controls.className = 'browser-controls';
controls.innerHTML =
  '<nav>' +
  scenarios.map((item) => '<a href="?scene=' + item.id + '">' + item.label + '</a>').join(' ') +
  '</nav><div><label>规模 <input id="count" type="number" min="2" value="' +
  (query.get('count') ?? (scene === 'csv' ? 50 : 30)) +
  '"></label><button id="theme">明暗主题</button><button id="reopen">重新打开</button><button id="reset">恢复样本</button>' +
  '<button id="close">关闭场景</button><span id="status" role="status">正在准备</span></div>';
const element = document.querySelector<HTMLElement>('#app')!;
const status = document.querySelector<HTMLElement>('#status')!;
const host = createBrowserHost(element);
const options: ScenarioOptions = {
  scene,
  count: 30,
  resourceSize: 0,
  monitor: false,
  theme: query.get('theme') === 'dark' ? 'dark' : 'light',
};
async function show(reset = false) {
  controls.querySelectorAll<HTMLButtonElement>('button').forEach((button) => (button.disabled = true));
  try {
    options.count = Number(document.querySelector<HTMLInputElement>('#count')!.value);
    const model = reset || !host.model ? createScenario(options) : host.model;
    if (query.has('readFailure')) model.failures.set('query_joint_edit', '样本来源读取失败，请重试');
    await host.open(model);
    const definition = scenarios.find((item) => item.id === scene)!;
    await until(() => Boolean(element.querySelector(definition.selector)), definition.label);
    host.setTheme(options.theme);
    status.textContent = definition.label + ' · ' + definition.capabilities.join('、');
    status.dataset.ready = 'true';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.dataset.ready = 'false';
  } finally {
    controls.querySelectorAll<HTMLButtonElement>('button').forEach((button) => (button.disabled = false));
  }
}
document.querySelector<HTMLButtonElement>('#theme')!.onclick = () => {
  options.theme = options.theme === 'light' ? 'dark' : 'light';
  host.setTheme(options.theme);
};
document.querySelector<HTMLButtonElement>('#reopen')!.onclick = () => void show();
document.querySelector<HTMLButtonElement>('#reset')!.onclick = () => void show(true);
async function close() {
  await host.close();
  status.textContent = '已关闭';
  status.dataset.ready = 'false';
}
document.querySelector<HTMLButtonElement>('#close')!.onclick = () => void close();
void listen('browser-close', close);
Object.assign(globalThis, { browserTest: { host, eventListenerCount } });
void show();
