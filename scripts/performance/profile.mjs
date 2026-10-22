import { writeFile } from 'node:fs/promises';

const [endpoint = 'http://127.0.0.1:9222', output = 'profile.cpuprofile', duration = '10000'] = process.argv.slice(2);
/** @type {{type: string, url: string, title: string, webSocketDebuggerUrl: string}[]} */
const pages = JSON.parse(await fetch(new URL('/json/list', endpoint)).then((response) => response.text()));
const page = pages.find((item) => item.type === 'page' && !item.url.startsWith('devtools:'));
if (!page) throw new Error('No application page exposed by the supplied DevTools endpoint');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let sequence = 0;
const pending = new Map();
socket.onmessage = (/** @type {{data: unknown}} */ { data }) => {
  const response = JSON.parse(String(data));
  if (!response.id) return;
  const request = pending.get(response.id);
  pending.delete(response.id);
  if (response.error) request.reject(new Error(response.error.message));
  else request.resolve(response.result);
};
/** @param {string} method */
function send(method) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method }));
  });
}
await send('Profiler.enable');
await send('Profiler.start');
console.log(`Profiling ${page.title} for ${Number(duration)}ms`);
await new Promise((resolve) => setTimeout(resolve, Number(duration)));
const { profile } = await send('Profiler.stop');
await writeFile(output, JSON.stringify(profile), 'utf8');
await send('Profiler.disable');
socket.close();
console.log(output);
