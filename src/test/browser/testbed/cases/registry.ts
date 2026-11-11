import type { RunOptions } from '../../contracts';
const list = async (element: HTMLElement, options: RunOptions) => (await import('./lists')).createListCase(element, options);
const editor = async (element: HTMLElement, options: RunOptions) => (await import('./editors')).createEditorCase(element, options);
const immersive = async (element: HTMLElement, options: RunOptions) => (await import('./immersive')).createImmersiveCase(element, options);
export const cases = {
  csv: list,
  weapons: list,
  wings: list,
  hullmods: list,
  'code-editor': editor,
  'text-editor': editor,
  'java-queries': editor,
  ship: immersive,
  skin: immersive,
  weapon: immersive,
  wing: immersive,
  variant: immersive,
};
