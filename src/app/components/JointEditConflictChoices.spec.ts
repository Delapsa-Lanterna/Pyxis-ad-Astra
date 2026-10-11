import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { ref, defineComponent } from 'vue';
import JointEditConflictChoices from './JointEditConflictChoices.vue';
import { editorUiStubs } from '@/test/ui-stubs';
import type { JointConflictChoice, JointEditConflict } from '@/shared/types';
describe('joint edit conflict selection component', () => {
  it('displays all three sources and emits a per-field choice without mutating its input', async () => {
    const conflicts: JointEditConflict[] = [
      {
        recordKey: 'ship',
        path: ['name'],
        baseline: { state: 'present', value: 'before' },
        disk: { state: 'present', value: 'disk' },
        draft: { state: 'present', value: 'draft' },
      },
    ];
    const choices: JointConflictChoice[] = [{ recordKey: 'ship', path: ['name'], choice: 'disk' }];
    const wrapper = mount(JointEditConflictChoices, { props: { conflicts, choices }, global: { stubs: editorUiStubs } });
    expect(wrapper.text()).toContain('原基线');
    expect(wrapper.text()).toContain('当前磁盘');
    expect(wrapper.text()).toContain('本窗口');
    await wrapper.get('select').setValue('"draft"');
    expect(wrapper.emitted('update:choices')![0]![0]).toEqual([{ recordKey: 'ship', path: ['name'], choice: 'draft' }]);
    expect(choices[0]!.choice).toBe('disk');
    wrapper.unmount();
  });
  it('keeps array and raw-text selection as whole field choices', async () => {
    const conflicts: JointEditConflict[] = [
      {
        recordKey: 'variant',
        path: ['weaponGroups'],
        baseline: { state: 'present', value: [] },
        disk: { state: 'present', value: [{ mode: 'LINKED' }] },
        draft: { state: 'present', value: [{ mode: 'ALTERNATING' }] },
      },
    ];
    const choices = ref<JointConflictChoice[]>([{ recordKey: 'variant', path: ['weaponGroups'], choice: 'disk' }]);
    const wrapper = mount(
      defineComponent({
        components: { JointEditConflictChoices },
        setup: () => ({ choices, conflicts }),
        template: '<JointEditConflictChoices :conflicts="conflicts" v-model:choices="choices" />',
      }),
      { global: { stubs: editorUiStubs } },
    );
    await wrapper.get('select').setValue('"draft"');
    expect(choices.value[0]!.choice).toBe('draft');
    expect(wrapper.findAll('pre')).toHaveLength(3);
    wrapper.unmount();
  });
});
