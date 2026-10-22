import { createServer as createHttpServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const stage = process.argv[2] ?? 'after';
const output = resolve(root, 'node_modules/.cache/retained-' + stage + '/bench');
const fixture = resolve(root, 'src/test/retained-lists.fixture.ts').replaceAll('\\', '/');
const baseline = process.argv[3] ?? 'HEAD';
const tracked = new Set(execFileSync('git', ['ls-files', '-z', 'src', 'schemas'], { cwd: root, encoding: 'utf8' }).split('\0'));
let entry = '',
  styles = '';
const assets = new Set();
if (process.argv.includes('--serve')) {
  for (const file of await readdir(resolve(output, 'assets'))) {
    assets.add('/assets/' + file);
    if (file.startsWith('retained-lists.browser-') && file.endsWith('.js')) entry = 'assets/' + file;
    if (file.endsWith('.css')) styles += `<link rel="stylesheet" href="/assets/${file}">`;
  }
} else
  await build({
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'warn',
    define: { 'import.meta.env.VITE_PERFORMANCE_MONITOR': JSON.stringify(stage === 'monitor-removed' ? '0' : '1') },
    plugins: [
      {
        name: 'retained-production-io',
        enforce: 'pre',
        load(id) {
          const path = id.replaceAll('\\', '/');
          const relative = path.slice(root.replaceAll('\\', '/').length);
          if (stage === 'before' && !path.includes('?') && tracked.has(relative) && /\.(vue|ts|css|json)$/.test(path))
            return execFileSync('git', ['show', baseline + ':' + relative], { cwd: root, encoding: 'utf8' });
        },
        generateBundle(_options, bundle) {
          for (const item of Object.values(bundle)) {
            assets.add('/' + item.fileName);
            if (item.type === 'chunk' && item.isEntry) entry = item.fileName;
            if (item.fileName.endsWith('.css')) styles += `<link rel="stylesheet" href="/${item.fileName}">`;
          }
        },
        transform(code, id) {
          const path = id.replaceAll('\\', '/');
          if (path.endsWith('/src/shared/runtime/command.runtime.ts'))
            return code.replace(
              "import { invoke } from '@tauri-apps/api/core';",
              `import {invokeCommand as invoke} from ${JSON.stringify(fixture)};`,
            );
          if (path.endsWith('/src/windows/current.window.ts'))
            return code.replace('return appWindow().label;', "return 'retained-benchmark';");
          if (path.endsWith('/src/windows/tauri.events.ts')) return code.replace('await emit(event, data);', 'void event;void data;');
          return code;
        },
      },
    ],
    build: {
      outDir: output,
      emptyOutDir: true,
      rollupOptions: { input: resolve(root, 'src/test/retained-lists.browser.ts') },
    },
  });
/** @type {unknown[]} */
const reports = [];
const server = createHttpServer(async (request, response) => {
  const path = new URL(/** @type {string} */ (request.url), 'http://localhost').pathname;
  if (path === '/results' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) body += chunk;
    const report = JSON.parse(body);
    reports.push(report);
    console.log(JSON.stringify(report));
    response.end('ok');
  } else if (path === '/results') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(reports));
  } else if (path === '/done') {
    response.on('finish', () => server.close());
    response.end('complete');
  } else if (path === '/') {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(
      `<!doctype html><meta charset="utf-8"><title>驻留列表生产基准 ${stage}</title>${styles}<div id="controls"></div><div id="app"></div><script type="module" src="/${entry}"></script>`,
    );
  } else if (assets.has(path)) {
    /** @type {Record<string, string>} */
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
    response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
    response.end(await readFile(resolve(output, '.' + path)));
  } else {
    response.statusCode = 404;
    response.end();
  }
});
server.listen(0, '127.0.0.1', () =>
  console.log(`RETAINED_BENCH ${stage} http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`),
);
