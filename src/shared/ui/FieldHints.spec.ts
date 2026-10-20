import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import FieldHints from './FieldHints.vue';

describe('field hints', () => {
  it.each(['description', 'warning', 'danger'] as const)('renders %s independently and accepts replacement text', async (kind) => {
    const view = mount(FieldHints, { props: { [kind]: 'Explanation' } });
    expect(view.findAll('p')).toHaveLength(1);
    expect(view.get(`.field-${kind}`).text()).toContain('Explanation');
    await view.setProps({ [kind]: 'Updated' });
    expect(view.get('p').text()).toContain('Updated');
    await view.setProps({ [kind]: '' });
    expect(view.find('p').exists()).toBe(false);
    view.unmount();
  });
  it('presents description, caution and risk in order and clears absent values', async () => {
    const view = mount(FieldHints, { props: { description: 'Details', warning: 'Caution', danger: 'Risk' } });
    expect(view.findAll('p').map((line) => line.text())).toEqual(['Details', '注意：Caution', '风险：Risk']);
    await view.setProps({ description: undefined, warning: undefined, danger: undefined });
    expect(view.find('p').exists()).toBe(false);
    view.unmount();
  });
});
