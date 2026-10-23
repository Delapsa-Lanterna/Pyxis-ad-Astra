import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/** @returns {import('vite').Plugin} */
export function browserTestPlugin() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  /** @type {Record<string, string>} */
  let metadata;
  return {
    name: 'browser-test-native',
    async config(_config, environment) {
      const files = (await readdir(root + 'src', { recursive: true })).filter(
        (path) => /\.(vue|ts)$/.test(path) && !path.startsWith('test'),
      );
      const text = (await Promise.all(files.map((path) => readFile(root + 'src/' + path, 'utf8')))).join('');
      metadata = {
        sourceHash: createHash('sha256').update(text).digest('hex'),
        scriptHash: createHash('sha256')
          .update(await readFile(root + 'src/test/browser/benchmark.ts'))
          .digest('hex'),
        build: environment.command + ':' + environment.mode,
      };
      const characters = [
        ...new Set(
          ' ?' +
            Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)).join('') +
            (text.match(/[\u00a0-\uffef]/g) ?? []).join(''),
        ),
      ].join('');
      return {
        define: { __BROWSER_FONT_CHARS__: JSON.stringify(characters) },
        resolve: {
          alias: ['@tauri-apps/api/core', '@tauri-apps/api/event', '@tauri-apps/api/window', '@tauri-apps/plugin-dialog'].map((find) => ({
            find,
            replacement: root + 'src/test/browser/native.ts',
          })),
        },
      };
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === '/environment') {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(metadata));
          return;
        }
        if (request.url?.split('?')[0] !== '/') return next();
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(
          '<!doctype html><html><head><meta charset="utf-8"><title>浏览器快速验证</title></head><body><div id="controls"></div><div id="app"></div><script type="module" src="/src/test/browser/entry.ts"></script></body></html>',
        );
      });
    },
  };
}
