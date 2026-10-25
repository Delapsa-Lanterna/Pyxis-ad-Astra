import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import AppImage from './AppImage.vue';

const closing = ref(false);
vi.mock('@/app/composables/use-window-close-state', () => ({ useWindowCloseState: () => closing }));
let view: ReturnType<typeof mount>;
afterEach(() => {
  view.unmount();
  closing.value = false;
});
it('preserves image attributes and locks the active preview with its window', async () => {
  view = mount(AppImage, {
    attachTo: document.body,
    attrs: { src: 'data:image/png;base64,fixture', alt: 'Fixture', width: '100%', height: '100%', imgProps: { class: 'fixture-image' } },
    global: { stubs: { transition: false } },
  });
  const image = view.get('img');
  expect(image.attributes()).toMatchObject({ alt: 'Fixture', width: '100%', height: '100%', class: 'fixture-image' });
  expect(image.element.style.objectFit).toBe('contain');
  await image.trigger('click');
  await flushPromises();
  expect(document.querySelector('.n-image-preview-container')).not.toBeNull();
  closing.value = true;
  await flushPromises();
  expect(document.querySelector('.n-image-preview-container')).toBeNull();
  await image.trigger('click');
  await flushPromises();
  expect(document.querySelector('.n-image-preview-container')).toBeNull();
  closing.value = false;
  await flushPromises();
  expect(document.querySelector('.n-image-preview-container')).not.toBeNull();
  await view.setProps({ previewDisabled: true });
  await flushPromises();
  expect(document.querySelector('.n-image-preview-container')).toBeNull();
  await view.setProps({ previewDisabled: false });
  await flushPromises();
  view.unmount();
  expect(document.querySelector('.n-image-preview-container')).toBeNull();
});
