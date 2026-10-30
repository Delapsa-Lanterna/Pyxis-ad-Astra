import { build } from 'vite';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserTestPlugin, root } from './vite-plugin.mjs';

/** @param {{mode?: 'browser' | 'testbed', directory: string, base?: string, demo?: boolean, monitorCode?: boolean}} options */
export function buildBrowser({ mode = 'browser', directory, base = '/', demo = false, monitorCode = true }) {
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
        input: resolve(root, 'src/test/browser/' + (mode === 'browser' ? 'entry.ts' : 'testbed.ts')),
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
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { base: { type: 'string', default: '/Pyxis-ad-Astra/' } } });
  await buildBrowser({ directory: resolve(root, 'dist/browser-demo'), base: values.base, demo: true, monitorCode: false });
}
