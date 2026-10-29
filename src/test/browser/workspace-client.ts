import type { BrowserWorkspace } from './workspace-runtime';

export const workspaceClient = () =>
  window.parent !== window ? (window.parent as Window & { browserWorkspace?: BrowserWorkspace }).browserWorkspace : undefined;
export const clientWindowLabel = () => new URLSearchParams(location.search).get('window')!;
