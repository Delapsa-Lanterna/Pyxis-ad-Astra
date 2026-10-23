import { createBrowserHost } from './host';
import { createBrowserModel, scenarioNames, type BrowserScenario } from './model';
import { listen, eventListenerCount } from './events';

const query = new URLSearchParams(location.search);
const scene = (query.get('case') ?? 'settings').split('-')[0] as BrowserScenario;
const count = Number(query.get('case')?.split('-')[1] ?? (scene === 'csv' ? 50 : 30));
document.body.style.cssText = 'display:flex;flex-direction:column;height:100vh';
document.body.classList.add('browser-preview');
const controls = document.querySelector<HTMLElement>('#controls')!;
controls.className = 'browser-controls';
controls.innerHTML =
  '<nav>' +
  scenarioNames.map((name) => `<a href="?case=${name}">${name}</a>`).join(' ') +
  '</nav>' +
  '<div><button id="theme">明暗主题</button><button id="reopen">重新打开</button><button id="reset">恢复样本</button><button id="close">关闭场景</button><span id="status">正在准备</span></div>';
const element = document.querySelector<HTMLElement>('#app')!;
element.style.cssText = 'flex:1;min-height:0;position:relative;transform:translateZ(0)';
const status = document.querySelector<HTMLElement>('#status')!;
const host = createBrowserHost(element);
let dark = query.get('theme') === 'dark';
const busy = (value: boolean) =>
  controls.querySelectorAll('button').forEach((button) => {
    button.disabled = value;
  });
async function show(reset = false) {
  busy(true);
  try {
    if (reset) await host.reset();
    else await host.open(host.model ?? createBrowserModel(scene, count));
    host.setTheme(dark ? 'dark' : 'light');
    status.textContent = '就绪';
    status.dataset.listeners = String(eventListenerCount());
  } catch (error) {
    status.textContent = String(error);
  } finally {
    busy(false);
  }
}
document.querySelector<HTMLButtonElement>('#theme')!.onclick = () => {
  dark = !dark;
  host.setTheme(dark ? 'dark' : 'light');
};
document.querySelector<HTMLButtonElement>('#reopen')!.onclick = () => void show();
document.querySelector<HTMLButtonElement>('#reset')!.onclick = () => void show(true);
async function closeScene() {
  busy(true);
  try {
    await host.close();
    status.textContent = '已关闭';
    status.dataset.listeners = String(eventListenerCount());
    status.dataset.media = JSON.stringify(host.mediaStats);
  } finally {
    busy(false);
  }
}
document.querySelector<HTMLButtonElement>('#close')!.onclick = () => void closeScene();
void listen('browser-close', closeScene);
Object.assign(globalThis, { browserTest: { host, eventListenerCount } });
void show();
