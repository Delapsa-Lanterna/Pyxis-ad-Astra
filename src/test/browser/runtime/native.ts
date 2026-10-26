import { browserModel, browserWindowLabel, invoke } from './commands';
import { listen, emit } from './events';
export { invoke, listen, emit };
export { emitTo } from './events';
export function getCurrentWindow() {
  return {
    label: browserWindowLabel(),
    close: () => emit('browser-close', null),
    onCloseRequested: (callback: () => void) => listen('browser-close-request', callback),
    show: async () => {},
    minimize: async () => {},
    toggleMaximize: async () => {},
    isMaximized: async () => false,
    startDragging: async () => {},
  };
}
export async function open(options: { directory?: boolean; title?: string }) {
  return options.directory ? (options.title?.includes('日志') ? 'M:/sample-logs' : 'M:/sample-game') : null;
}
export const convertFileSrc = (path: string) => path;
export const isTauri = () => false;
export function getVersion() {
  return Promise.resolve('browser-sample');
}
export function getName() {
  return Promise.resolve('浏览器验证');
}
export async function writeText(text: string) {
  await navigator.clipboard.writeText(text);
}
export const readText = () => navigator.clipboard.readText();
export const fixtureWindowState = () => browserModel().context;
