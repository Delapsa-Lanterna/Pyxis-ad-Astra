import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const root = fileURLToPath(new URL('../../', import.meta.url));
/** @param {'browser' | 'testbed'} mode */
export function browserTestPlugin(mode = 'browser') {
  const entry = 'src/test/browser/' + (mode === 'browser' ? 'entry.ts' : 'testbed.ts');
  /** @type {Record<string, string>} */
  let metadata;
  /** @type {import('vite').Plugin} */
  const plugin = {
    name: 'browser-simulation',
    async config(_config, environment) {
      const paths = [];
      for (const folder of ['src', 'schemas', 'scripts/browser', 'scripts/shared']) {
        for (const path of await readdir(root + folder, { recursive: true }))
          if (/\.(vue|ts|mjs|mts|css|json|csv|ship|skin|wpn|proj|variant|system|skill|faction|txt)$/.test(path))
            paths.push(folder + '/' + path.replaceAll('\\', '/'));
      }
      paths.push('package-lock.json', 'vite.config.ts');
      paths.sort();
      const sources = await Promise.all(paths.map((path) => readFile(root + path, 'utf8')));
      const hash = createHash('sha256');
      paths.forEach((path, index) => hash.update(path).update('\0').update(sources[index]).update('\0'));
      metadata = { sourceHash: hash.digest('hex'), operationVersion: '1', build: environment.command + ':' + environment.mode, mode };
      const characters = [
        ...new Set(
          ' ?' +
            Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join('') +
            (sources.join('').match(/[\u00a0-\uffef]/g) ?? []).join(''),
        ),
      ].join('');
      return {
        cacheDir: root + 'node_modules/.cache/browser/vite-' + mode,
        define: { __BROWSER_FONT_CHARS__: JSON.stringify(characters) },
        resolve: {
          alias: [
            '@tauri-apps/api/core',
            '@tauri-apps/api/event',
            '@tauri-apps/api/window',
            '@tauri-apps/api/app',
            '@tauri-apps/plugin-dialog',
            '@tauri-apps/plugin-clipboard-manager',
          ].map((find) => ({
            find,
            replacement: root + 'src/test/browser/runtime/native.ts',
          })),
        },
      };
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        if (path === '/environment') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(metadata));
        } else if (path === '/') {
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(html('/' + entry, '', mode));
        } else next();
      });
    },
    generateBundle(_options, bundle) {
      let script = '',
        styles = '';
      const hash = createHash('sha256');
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name];
        hash.update(name).update(item.type === 'chunk' ? item.code : item.source);
        if (item.type === 'chunk' && item.isEntry) script = '/' + item.fileName;
        if (item.fileName.endsWith('.css')) styles += '<link rel="stylesheet" href="/' + item.fileName + '">';
      }
      metadata.buildHash = hash.digest('hex');
      this.emitFile({ type: 'asset', fileName: 'index.html', source: html(script, styles, mode) });
      this.emitFile({ type: 'asset', fileName: 'environment.json', source: JSON.stringify(metadata) });
    },
  };
  return plugin;
}
/** @param {string} script @param {string} styles @param {string} mode */
function html(script, styles, mode) {
  return (
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    (mode === 'browser' ? '前端测试工作区' : '性能测试台') +
    '</title>' +
    styles +
    '</head><body><div id="controls"></div><div id="app"></div><script type="module" src="' +
    script +
    '"></script></body></html>'
  );
}
