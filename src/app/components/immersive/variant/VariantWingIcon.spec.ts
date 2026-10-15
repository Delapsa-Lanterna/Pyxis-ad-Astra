import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { JointEditSnapshot } from '@/shared/types';
import { wingJointFixture } from '@/test/wing-joint-edit';
import VariantWingIcon from './VariantWingIcon.vue';
import { jointObject } from '@/domain/joint-edit';

const candidate = vi.hoisted(() => ({ snapshot: null as JointEditSnapshot | null }));
vi.mock('@/app/composables/immersive-editor/variant/use-variant-candidate', async () => {
  const { computed, shallowRef } = await import('vue');
  return {
    useVariantCandidate: () => {
      const snapshot = shallowRef(candidate.snapshot);
      return { snapshot, values: computed(() => Object.fromEntries(snapshot.value!.records.map((record) => [record.key, record.value]))) };
    },
  };
});
function harness() {
  candidate.snapshot = wingJointFixture();
  return mount(VariantWingIcon, {
    props: { root: candidate.snapshot.root, id: 'sarissa_wing', size: 64, rendererSize: 72 },
    global: {
      stubs: {
        ImmersiveHullScene: { name: 'ImmersiveHullScene', props: ['wingLayout', 'iconSize'], template: '<canvas />' },
        ImmersiveText: true,
      },
    },
  });
}
describe('wing bay and candidate formation consumer', () => {
  it('reads the actual wing record formation and scales identically in the bay and card', async () => {
    const wrapper = harness();
    const scene = wrapper.findComponent({ name: 'ImmersiveHullScene' });
    expect(scene.props('wingLayout').points[0].y).toBeCloseTo(11.88);
    expect(scene.props('wingLayout').spriteHeight).toBeCloseTo(21.6);
    await wrapper.setProps({ size: 69 });
    expect(scene.props('iconSize')).toBe(69);
    expect(scene.props('wingLayout').spriteHeight).toBeCloseTo(21.6);
    wrapper.unmount();
  });
  it('shows source diagnostics when the wing formation is missing', async () => {
    candidate.snapshot = wingJointFixture();
    const record = candidate.snapshot.records.find((record) => record.key === 'wing')!;
    const data = { ...jointObject(record.value) };
    delete data.formation;
    record.value = { state: 'present', value: data };
    const wrapper = mount(VariantWingIcon, {
      props: { root: candidate.snapshot.root, id: 'sarissa_wing', size: 64, rendererSize: 72 },
      global: { stubs: { ImmersiveHullScene: true, ImmersiveText: { props: ['text'], template: '<span>{{text}}</span>' } } },
    });
    await flushPromises();
    expect(wrapper.text()).toBe('编队来源缺失');
    expect(wrapper.attributes('title')).toContain('阵型缺失');
    wrapper.unmount();
  });
});
