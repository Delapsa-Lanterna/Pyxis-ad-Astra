import { browserModel, browserWindowLabel, invoke as invokeScene } from './commands';
import { listen as listenScene, emit as emitScene } from './events';
import { clientWindowLabel, workspaceClient } from '../workspace-client';
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const workspace = workspaceClient();
  try {
    return workspace
      ? (structuredClone(await workspace.invoke(clientWindowLabel(), command, args ?? {})) as T)
      : await invokeScene<T>(command, args);
  } catch (error) {
    const diagnostic = error as { code?: string; message: string; location?: unknown };
    throw { code: diagnostic.code ?? 'browser.fixture', message: diagnostic.message, location: diagnostic.location ?? null };
  }
}
export async function listen<T>(
  event: string,
  handler: (event: { event: string; id: number; payload: T }) => void | Promise<void>,
  options?: { target?: string },
) {
  const workspace = workspaceClient();
  return workspace
    ? workspace.listen(clientWindowLabel(), event, handler as never, options?.target)
    : listenScene(event, handler as never, options);
}
export const emit = emitScene;
export { emitTo } from './events';
export class Channel<T> {
  constructor(public onmessage: (message: T) => void) {}
}
export function getCurrentWindow() {
  return {
    get label() {
      return workspaceClient() ? clientWindowLabel() : browserWindowLabel();
    },
    close: () => {
      const workspace = workspaceClient();
      return workspace ? emitScene('browser-close-request', { preventDefault() {} }) : emit('browser-close', null);
    },
    onCloseRequested: (callback: (event: { preventDefault(): void }) => void) =>
      listenScene('browser-close-request', (message) => callback(message.payload as { preventDefault(): void })),
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
