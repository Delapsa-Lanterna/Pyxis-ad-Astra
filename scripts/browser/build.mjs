import { build } from 'vite';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserTestPlugin, root } from './vite-plugin.mjs';

export const demoBase = '/Pyxis-ad-Astra/';

/** @param {{mode?: 'preview' | 'testbed', directory: string, base?: string, demo?: boolean, monitorCode?: boolean}} options */
export function buildBrowser({ mode = 'preview', directory, base = '/', demo = false, monitorCode = true }) {
  return build({
    configFile: resolve(root, 'vite.config.ts'),
    base,
    plugins: [browserTestPlugin(mode)],
    define: {
      'import.meta.env.VITE_BROWSER_DEMO': JSON.stringify(demo),
      'import.meta.env.VITE_PERFORMANCE_MONITOR': JSON.stringify(monitorCode ? '1' : '0'),
    },
    build: {
      outDir: directory,
      emptyOutDir: true,
      rolldownOptions: {
        input: resolve(root, 'src/test/browser/' + mode + '/entry.ts'),
        output: {
          codeSplitting: {
            groups: [
              { name: 'samples', test: /\/game\//, maxSize: 400000 },
              { name: 'schemas', test: /\/schemas\/.*\.json/, maxSize: 400000 },
            ],
          },
        },
      },
    },
  });
}
/** @param {string} directory @param {string} base */
export async function buildDemo(directory, base) {
  await buildBrowser({ directory, base, demo: true, monitorCode: false });
  await buildBrowser({
    mode: 'testbed',
    directory: resolve(directory, 'testbed'),
    base: base + 'testbed/',
    demo: true,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { base: { type: 'string', default: demoBase } } });
  await buildDemo(resolve(root, 'dist/browser-demo'), values.base);
}
