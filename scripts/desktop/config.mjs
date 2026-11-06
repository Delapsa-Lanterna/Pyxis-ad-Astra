import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const configPath = resolve(root, 'src-tauri/tauri.desktop-testing.conf.json');
export const targetDirectory = resolve(root, 'src-tauri/target/desktop-testing');
export const executable = resolve(targetDirectory, 'release/pyxis-ad-astra.exe');
export const cacheDirectory = resolve(root, 'node_modules/.cache/desktop-testing');
export const stores = 'document.querySelector("#app").__vue_app__.config.globalProperties.$pinia._s';
export const invoke = 'window.__TAURI_INTERNALS__.invoke';

/** @param {boolean} [isolatedDesktop] */
export async function desktopConfiguration(isolatedDesktop = false) {
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const port = Number(String(config.app.windows[0].additionalBrowserArgs).split('--remote-debugging-port=')[1]?.split(' ')[0]);
  return {
    identifier: String(config.identifier),
    port,
    endpoint: 'http://127.0.0.1:' + port,
    isolation: isolatedDesktop ? 'win32-desktop' : 'user-desktop',
  };
}
