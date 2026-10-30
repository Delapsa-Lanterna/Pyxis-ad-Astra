import { createServer } from 'vite';
import { createServer as createHttpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserTestPlugin, root } from './vite-plugin.mjs';
import { TestWorkspace } from '../shared/test-workspace.mjs';
import { buildBrowser } from './build.mjs';

/** @param {{ mode?: 'browser' | 'testbed', production?: boolean, directory?: string, port?: number, rebuild?: boolean, monitorCode?: boolean, base?: string }} options */
export async function serve({
  mode = 'testbed',
  production = false,
  directory = 'node_modules/.cache/browser/testbed',
  port = 0,
  rebuild = true,
  monitorCode = true,
  base = '/',
} = {}) {
  if (!production) {
    const server = await createServer({
      plugins: [browserTestPlugin(mode)],
      server: { host: '127.0.0.1', port, strictPort: true, open: false },
    });
    try {
      await server.listen();
    } catch (error) {
      await server.close();
      throw error;
    }
    const address = /** @type {import('node:net').AddressInfo} */ (server.httpServer?.address());
    return { url: 'http://127.0.0.1:' + address.port, close: () => server.close() };
  }
  const workspace = rebuild ? await TestWorkspace.create(resolve(root, directory), 'build') : null;
  const output = workspace?.root ?? resolve(root, directory);
  try {
    if (rebuild) await buildBrowser({ mode, directory: output, monitorCode, base });
    /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
    async function respond(request, response) {
      try {
        const pathname = new URL(/** @type {string} */ (request.url), 'http://localhost').pathname;
        if (!pathname.startsWith(base)) {
          response.writeHead(404).end();
          return;
        }
        const localPath = '/' + pathname.slice(base.length);
        const relative =
          localPath === '/' ? 'index.html' : localPath === '/environment' ? 'environment.json' : decodeURIComponent(localPath.slice(1));
        const path = resolve(output, relative);
        if (!path.startsWith(output + sep)) {
          response.writeHead(403).end();
          return;
        }
        const data = await readFile(path);
        const mime = /** @type {Record<string, string>} */ ({
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.svg': 'image/svg+xml',
        });
        response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
        response.end(data);
      } catch (error) {
        response.writeHead(error instanceof URIError ? 400 : 404).end(String(error));
      }
    }
    const server = createHttpServer((request, response) => void respond(request, response));
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => done(undefined));
    });
    return {
      url: 'http://127.0.0.1:' + /** @type {import('node:net').AddressInfo} */ (server.address()).port,
      close: async () => {
        try {
          await new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done(undefined)));
            server.closeIdleConnections();
          });
        } finally {
          await workspace?.close();
        }
      },
    };
  } catch (error) {
    try {
      await workspace?.close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], 'Browser build and cleanup failed', { cause: cleanup });
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const mode = process.argv[2] === 'browser' ? 'browser' : 'testbed';
  const production = process.argv.includes('--production');
  const directoryFlag = process.argv.indexOf('--directory');
  const baseFlag = process.argv.indexOf('--base');
  const portFlag = process.argv.indexOf('--port');
  const server = await serve({
    mode,
    production,
    port: portFlag < 0 ? (production ? 0 : mode === 'browser' ? 1461 : 1462) : Number(process.argv[portFlag + 1]),
    base: baseFlag < 0 ? '/' : process.argv[baseFlag + 1],
    directory: directoryFlag < 0 ? undefined : process.argv[directoryFlag + 1],
    rebuild: !process.argv.includes('--existing'),
    monitorCode: !process.argv.includes('--no-monitor-code'),
  });
  console.log(mode.toUpperCase() + ' ' + server.url);
  function close() {
    void server.close().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
