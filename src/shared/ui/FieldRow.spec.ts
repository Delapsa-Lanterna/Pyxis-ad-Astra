import { mount } from '@vue/test-utils';
import { h, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import FieldRow from './FieldRow.vue';
describe('field composition', () => {
  it('presents an explicit label, key and full path with its hint and action', async () => {
    const action = vi.fn();
    const view = mount(FieldRow, {
      props: { label: '条目', fieldKey: 'value', path: 'items[0].value' },
      slots: {
        default: () => h('input'),
        hint: () => h('p', 'Field description'),
        actions: () => h('button', { onClick: action }, 'Apply'),
      },
    });
    expect(view.get('.field-label-name').text()).toBe('条目');
    expect(view.get('.field-label-key').text()).toBe('value');
    expect(view.get('.field-label').attributes('title')).toBe('items[0].value');
    expect(view.text()).toContain('Field description');
    await view.get('button').trigger('click');
    expect(action).toHaveBeenCalledOnce();
    view.unmount();
  });
  it('preserves its control when the presentation changes to a collection', async () => {
    const raw = ref('pending');
    const view = mount(FieldRow, {
      props: { label: '条目', layout: 'row' },
      slots: {
        default: () => h('input', { value: raw.value, onInput: (event: Event) => (raw.value = (event.target as HTMLInputElement).value) }),
      },
    });
    const input = view.get('input').element;
    await view.get('input').setValue('pending raw');
    await view.setProps({ layout: 'group' });
    expect(view.get('input').element).toBe(input);
    expect(input.value).toBe('pending raw');
    view.unmount();
  });
});
