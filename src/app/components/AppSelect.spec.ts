import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NSelect } from 'naive-ui/es/select';
import AppSelect from './AppSelect.vue';
let view: ReturnType<typeof mount>;
beforeEach(() => Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() }));
afterEach(() => {
  view.unmount();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});
it.each([false, true])('focuses the body and closes only through the arrow, filterable=%s', async (filterable) => {
  view = mount(AppSelect, {
    props: { filterable },
    attrs: { options: [{ label: 'Sample', value: 'sample' }], virtualScroll: false },
    attachTo: document.body,
  });
  await view.get('.n-base-selection').trigger('click');
  await flushPromises();
  await view.get('.n-base-selection-label').trigger('click');
  expect(view.getComponent(NSelect).props('show')).toBe(true);
  await view.get('.n-base-suffix__arrow svg').trigger('click');
  expect(view.getComponent(NSelect).props('show')).toBe(false);
  await view.get('.n-base-suffix__arrow svg').trigger('click');
  expect(view.getComponent(NSelect).props('show')).toBe(true);
  await view.get('.n-base-selection').trigger('keydown', { key: 'Escape' });
  expect(view.getComponent(NSelect).props('show')).toBe(false);
});
it('preserves selection clearing, tag removal and controlled visibility', async () => {
  const update = vi.fn();
  view = mount(AppSelect, {
    props: { show: true, filterable: true },
    attrs: {
      value: ['a', 'b'],
      options: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ],
      multiple: true,
      clearable: true,
      virtualScroll: false,
      'onUpdate:value': update,
    },
    attachTo: document.body,
  });
  await view.get('.n-tag__close').trigger('click');
  expect(update.mock.calls.at(-1)![0]).toEqual(['b']);
  await view.get('[data-clear]').trigger('click');
  expect(update.mock.calls.at(-1)![0]).toEqual([]);
  await view.setProps({ filterable: false, clearable: false });
  await view.get('.n-base-suffix__arrow').trigger('click');
  expect(view.emitted('update:show')!.at(-1)).toEqual([false]);
  await view.setProps({ show: false });
  expect(view.getComponent(NSelect).props('show')).toBe(false);
});
