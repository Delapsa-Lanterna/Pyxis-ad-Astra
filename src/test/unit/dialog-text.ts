import { createApp, h, render, nextTick } from 'vue';
import { VueWrapper } from '@vue/test-utils';
import { NSelect } from 'naive-ui/es/select';
import type { ChooseOptions, ConfirmOptions } from '@/shared/types';

export function dialogText(options: Pick<ChooseOptions | ConfirmOptions, 'content'>) {
  const host = document.createElement('div');
  render(h('div', [typeof options.content === 'function' ? options.content() : options.content]), host);
  const text = host.textContent!;
  render(null, host);
  return text;
}
export async function selectDialogOption(options: Pick<ChooseOptions | ConfirmOptions, 'content'>, label: string, value: string) {
  const app = createApp({ render: () => h('div', [typeof options.content === 'function' ? options.content() : options.content]) });
  const wrapper = new VueWrapper(app, app.mount(document.createElement('div')));
  wrapper
    .findAllComponents(NSelect)
    .find((select) => select.attributes('aria-label') === label)!
    .vm.$emit('update:value', value);
  await nextTick();
  const text = wrapper.text();
  app.unmount();
  return text;
}
