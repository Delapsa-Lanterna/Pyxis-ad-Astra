import { createApp } from 'vue';
import BrowserHeader from './BrowserHeader.vue';

export function mountBrowserHeader(element: HTMLElement, title: string, actions: HTMLElement, status: HTMLElement) {
  createApp(BrowserHeader, { title }).mount(element);
  element.querySelector('.workbench-actions')!.append(...actions.childNodes);
  element.querySelector('output')!.append(status);
  actions.remove();
}
