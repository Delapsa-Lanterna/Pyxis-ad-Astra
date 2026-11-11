import { afterEach, expect, it } from 'vitest';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { shallowRef } from 'vue';
import { ViewPlugin } from '@codemirror/view';
import { createTextDocument, readTextContent } from '@/shared/runtime/text-document';
import { createFieldInputs } from '@/shared/runtime/field-inputs';
import TextEditorSurface from './TextEditorSurface.vue';

enableAutoUnmount(afterEach);
it('preserves live plugins when the current document receives new extensions', async () => {
  const document = createTextDocument(
    shallowRef(readTextContent('class Sample {}')),
    shallowRef(null),
    shallowRef(100),
    createFieldInputs(),
  );
  let created = 0,
    destroyed = 0;
  const plugin = ViewPlugin.define(() => {
    created++;
    return {
      destroy: () => {
        destroyed++;
      },
    };
  });
  const wrapper = mount(TextEditorSurface, { props: { document, extensions: [plugin] } });
  try {
    expect(created).toBe(1);
    document.locate(1, 8);
    await wrapper.setProps({ extensions: [plugin] });
    expect(created).toBe(1);
    expect(destroyed).toBe(0);
    expect(document.state.value.selection.main.head).toBe(7);
    wrapper.unmount();
    expect(destroyed).toBe(1);
  } finally {
    wrapper.unmount();
    document.dispose();
  }
});
