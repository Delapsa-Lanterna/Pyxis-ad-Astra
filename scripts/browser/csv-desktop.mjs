import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import ts from 'typescript';
import { summarize } from '../shared/sample-statistics.mjs';

/** @typedef {{ send(method: string, params?: Record<string, unknown>): Promise<any>, evaluate(expression: string): Promise<any>, close(): Promise<void> }} Client */

const { values } = parseArgs({
  options: {
    exe: { type: 'string', default: 'src-tauri/target/release/circinus-ad-astra.exe' },
    mod: { type: 'string' },
    rounds: { type: 'string', default: '30' },
    phase: { type: 'string', default: 'all' },
    port: { type: 'string', default: '9233' },
    output: { type: 'string', default: 'src-tauri/target/performance/csv-rendering.json' },
    screenshots: { type: 'boolean', default: false },
  },
});
if (!values.mod) throw Error('Supply --mod with an already registered project directory');
/** @type {Array<{name: string; round: number; ms: number; namesMs: number; imagesMs: number}>} */
const samples = [];
const rounds = Number(values.rounds),
  exe = resolve(values.exe);
const endpoint = 'http://127.0.0.1:' + values.port;
/** @param {number} ms */
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
/** @param {string} path */
const normalize = (path) =>
  path
    .replace(/^\\\\\?\\/, '')
    .replaceAll('\\', '/')
    .replace(/\/$/, '')
    .toLowerCase();

/** @returns {Promise<Client>} */
async function connect() {
  const app = spawn(exe, [], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + values.port },
  });
  const exited = new Promise((done) => app.once('exit', done));
  let page;
  for (let attempt = 0; attempt < 150; attempt++) {
    const pages = /** @type {Array<{type: string; url: string; webSocketDebuggerUrl: string}>} */ (
      await fetch(endpoint + '/json/list', { signal: AbortSignal.timeout(1000) })
        .then((response) => response.json())
        .catch(() => [])
    );
    page = pages.find((candidate) => candidate.type === 'page' && candidate.url.startsWith('http://tauri.localhost'));
    if (page) break;
    await delay(100);
  }
  if (!page) throw Error('Application WebView did not become available');
  const socket = new WebSocket(page.webSocketDebuggerUrl),
    pending = new Map();
  await new Promise((done, reject) => {
    socket.onopen = done;
    socket.onerror = reject;
  });
  let sequence = 0;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(String(data)),
      request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  socket.onclose = () => {
    for (const request of pending.values()) request.reject(Error('WebView closed'));
    pending.clear();
  };
  /** @param {string} method @param {Record<string, unknown>} params @returns {Promise<any>} */
  const send = (method, params = {}) =>
    new Promise((done, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve: done, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  /** @param {string} expression */
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  return {
    send,
    evaluate,
    close: async () => {
      await evaluate('document.querySelector(".titlebar-button.close").click()');
      await exited;
      socket.close();
    },
  };
}

/** @param {Client} client */
async function prepare(client) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await client.evaluate('!!document.querySelector(".mod-tab-activate")')) break;
    await delay(100);
  }
  const environment = await client.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})');
  if (environment.width !== 1360 || environment.height !== 860 || environment.dpr !== 1.5)
    throw Error('Unexpected viewport: ' + JSON.stringify(environment));
  const browser = await readFile(new URL('../../src/test/browser/cases/csv-desktop.ts', import.meta.url), 'utf8');
  const code = ts
    .transpileModule(browser, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } })
    .outputText.replace('export function installAudit', 'function installAudit');
  await client.evaluate('(()=>{' + code + ';return installAudit()})()');
  for (let attempt = 0; attempt < 150; attempt++) {
    await client.evaluate('__csvBench.activateMod(' + JSON.stringify(normalize(/** @type {string} */ (values.mod))) + ')');
    if (await client.evaluate('!!document.querySelector(".mod-navigation-button")')) break;
    await delay(100);
  }
  return environment;
}
/** @param {Client} client @param {string} name @param {string} label @param {string} operation @param {number} round */
async function sample(client, name, label, operation, round) {
  const result = await client.evaluate('__csvBench.measure(' + JSON.stringify(label) + ',' + JSON.stringify(operation) + ',' + round + ')');
  samples.push({ name, round, ...result });
}
let environment;
if (values.phase !== 'warm')
  for (let round = 0; round < rounds; round++) {
    const client = await connect();
    try {
      environment = await prepare(client);
      await sample(client, 'first-ships', '舰船', 'switch', round);
      await sample(client, 'first-weapons', '武器', 'switch', round);
      console.log('First visits ' + (round + 1) + '/' + rounds);
    } finally {
      await client.close();
    }
  }
if (values.phase !== 'cold') {
  const client = await connect();
  try {
    environment = await prepare(client);
    await client.evaluate('__csvBench.measure("舰船","switch",0)');
    await client.evaluate('__csvBench.measure("武器","switch",0)');
    for (let round = 0; round < rounds; round++) {
      await sample(client, 'switch-ships', '舰船', 'switch', round);
      await sample(client, 'tail', '舰船', 'tail', round);
      await sample(client, 'top', '舰船', 'top', round);
      await sample(client, 'right', '舰船', 'right', round);
      await sample(client, 'left', '舰船', 'left', round);
      await sample(client, 'vertical', '舰船', 'vertical', round);
      await sample(client, 'horizontal', '舰船', 'horizontal', round);
      await sample(client, 'continuous', '舰船', 'continuous', round);
      await sample(client, 'switch-weapons', '武器', 'switch', round);
      console.log('Navigation and scroll ' + (round + 1) + '/' + rounds);
    }
    if (values.screenshots) {
      await client.evaluate('__csvBench.measure("舰船","switch",0)');
      for (const theme of ['dark', 'light'])
        for (const width of [1360, 1100]) {
          await client.evaluate(
            'document.querySelector("#app").__vue_app__.config.globalProperties.$pinia._s.get("settings").setTheme(' +
              JSON.stringify(theme) +
              ')',
          );
          await client.send('Emulation.setDeviceMetricsOverride', { width, height: 860, deviceScaleFactor: 1.5, mobile: false });
          await delay(300);
          const shot = await client.send('Page.captureScreenshot', { format: 'png' });
          const path = resolve(dirname(values.output), 'csv-' + theme + '-' + width + '.png');
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, Buffer.from(shot.data, 'base64'));
        }
      await client.send('Emulation.clearDeviceMetricsOverride');
      await client.evaluate(
        'document.querySelector("#app").__vue_app__.config.globalProperties.$pinia._s.get("settings").setTheme("dark")',
      );
    }
  } finally {
    await client.close();
  }
}
const statistics = Object.fromEntries(
  [...new Set(samples.map((sample) => sample.name))].map((name) => {
    const rows = samples.filter((sample) => sample.name === name);
    return [
      name,
      Object.fromEntries(/** @type {const} */ (['ms', 'namesMs', 'imagesMs']).map((key) => [key, summarize(rows.map((row) => row[key]))])),
    ];
  }),
);
const bytes = await readFile(exe),
  settings = JSON.parse(
    await readFile(resolve(/** @type {string} */ (process.env.APPDATA), 'com.caopancake.circinus-ad-astra/settings.json'), 'utf8'),
  );
const report = {
  exe,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  exeBytes: (await stat(exe)).size,
  environment,
  logLevel: settings.logLevel,
  monitor: settings.performanceMonitorEnabled,
  samples,
  statistics,
};
await mkdir(dirname(resolve(values.output)), { recursive: true });
await writeFile(resolve(values.output), JSON.stringify(report, null, 2) + '\n', 'utf8');
const labels = {
  'first-ships': '首次进入舰船',
  'first-weapons': '首次进入武器',
  'switch-ships': '切回舰船',
  'switch-weapons': '切回武器',
  tail: '纵向跳到表尾',
  top: '纵向返回顶部',
  right: '横向跳到最右',
  left: '横向返回最左',
  vertical: '纵向定位',
  horizontal: '横向定位',
  continuous: '连续纵向滚动',
};
const passed = Object.values(statistics).every((row) => row.ms.p95 <= 200);
const rows = Object.entries(statistics).map(
  ([name, result]) =>
    '| ' +
    labels[/** @type {keyof typeof labels} */ (name)] +
    ' | ' +
    /** @type {const} */ (['n', 'min', 'max', 'mean', 'median', 'p95'])
      .map((key) => /** @type {number} */ (result.ms[key]).toFixed(key === 'n' ? 0 : 2))
      .join(' | ') +
    ' |',
);
const auxiliary = Object.entries(statistics).map(
  ([name, result]) =>
    '| ' +
    labels[/** @type {keyof typeof labels} */ (name)] +
    ' | ' +
    result.namesMs.p95.toFixed(2) +
    ' | ' +
    result.imagesMs.p95.toFixed(2) +
    ' |',
);
const text =
  '# CSV 显示性能验收\n\n' +
  (passed ? '通过' : '未通过') +
  '：' +
  Object.keys(statistics).length +
  ' 个场景，共 ' +
  samples.length +
  ' 次测量，可视字段显示 P95 目标为 200 ms。\n\n' +
  '环境：真实 EXE，Kratogen，Smart，' +
  environment.width +
  '×' +
  environment.height +
  '，DPR ' +
  environment.dpr +
  '，日志 ' +
  report.logLevel +
  '，性能监视' +
  (report.monitor ? '开启' : '关闭') +
  '。时间单位均为 ms。\n\n' +
  '计时从导航或滚动开始，核对全部可视行、可视列及实际字段文字，并等待随后的一次绘制帧。首次进入沿用原始 ID 先显示、名称随后补全的流程。\n\n' +
  '| 场景 | 次数 | 最小 | 最大 | 平均 | 中位 | P95 |\n|---|---:|---:|---:|---:|---:|---:|\n' +
  rows.join('\n') +
  '\n\n名称与可视缩略图单独计时，其 P95 如下：\n\n| 场景 | 名称就绪 | 缩略图就绪 |\n|---|---:|---:|\n' +
  auxiliary.join('\n') +
  '\n\n构建 SHA-256：' +
  report.sha256 +
  '；EXE 大小：' +
  report.exeBytes +
  ' 字节。完整逐次结果见同名 JSON。\n';
await writeFile(resolve(values.output).replace(/\.json$/, '.md'), text, 'utf8');
console.log(JSON.stringify(statistics, null, 2));
if (Object.values(statistics).some((row) => row.ms.p95 > 200)) process.exitCode = 1;
