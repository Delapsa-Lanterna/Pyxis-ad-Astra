import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JointVariantEntry } from '@/shared/types';
import { wingJointFixture } from '@/test/fixtures/joint-edit/wing-joint-edit';
import VariantCandidateCard from './VariantCandidateCard.vue';
import { jointObject } from '@/domain/joint-edit';
const media = vi.hoisted(() => ({ replace: vi.fn(), query: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('@/app/composables/use-resource-media-registry', () => ({
  useResourceMediaRegistry: () => ({ replaceCollection: media.replace, dataUrl: () => '' }),
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: media.error, warning: media.warning }) }));
vi.mock('@/services/joint-edit.service', () => ({ queryJointCandidate: media.query }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function harness(kind: 'weapons' | 'wings', visibility: { current?: boolean; active?: boolean } = { active: false }) {
  const snapshot = wingJointFixture();
  const source = snapshot.records[0]!.source!;
  const entry: JointVariantEntry = {
    id: 'candidate',
    label: '候选',
    source,
    sourceVersion: snapshot.records[0]!.sourceVersion!,
    specSource: null,
    specVersion: null,
    resourceRefs: {
      turretSprite: { source: 'mod', relPath: 'weapon.png', ownerKind: 'weapon', ownerId: 'candidate', key: 'turretSprite' },
    },
    data: { num: '3', formation: 'CLAW', range: '500' },
    spec: { type: 'ENERGY', size: 'SMALL' },
    primaryRole: '测试用途',
    projectile: null,
    preview: kind === 'wings' ? { hull: snapshot.hull!, spec: jointObject(snapshot.records[0]!.value), specs: [] } : null,
  };
  const wrapper = mount(VariantCandidateCard, {
    props: { root: snapshot.root, kind, entry, cost: 12, diagnostic: '', mediaUrl: () => '', ...visibility },
    global: {
      stubs: {
        ImmersiveText: { props: ['text'], template: '<span>{{text}}</span>' },
        ImmersiveWeaponIcon: { name: 'ImmersiveWeaponIcon', props: ['layers', 'mountType', 'mountSize', 'active'], template: '<canvas/>' },
        ImmersiveHullThumbnail: { name: 'ImmersiveHullThumbnail', props: ['variant', 'wingLayout', 'active'], template: '<canvas/>' },
      },
    },
  });
  return {
    wrapper,
    entry,
    show: (value: boolean) => wrapper.setProps({ active: value }),
    showBatch: (values: boolean[]) => wrapper.setProps({ active: values.at(-1)! }),
  };
}
describe('catalog-driven candidate cards', () => {
  it.each(['weapons', 'wings'] as const)('shows the equipped %s preview when viewport visibility is omitted', (kind) => {
    const own = harness(kind, { current: true });
    expect(own.wrapper.find('canvas').exists()).toBe(true);
    own.wrapper.unmount();
  });
  it.each(['weapons', 'wings'] as const)('accepts the latest queued scroll visibility for %s', async (kind) => {
    const own = harness(kind);
    own.showBatch([false, true]);
    await flushPromises();
    expect(own.wrapper.find('canvas').exists()).toBe(true);
    own.showBatch([true, false]);
    await flushPromises();
    expect(own.wrapper.find('canvas').exists()).toBe(true);
    expect(own.wrapper.findComponent({ name: kind === 'weapons' ? 'ImmersiveWeaponIcon' : 'ImmersiveHullThumbnail' }).props('active')).toBe(
      false,
    );
    own.showBatch([false, true, false, true]);
    await flushPromises();
    expect(own.wrapper.find('canvas').exists()).toBe(true);
    own.wrapper.unmount();
  });
  it('renders metadata immediately and acquires visible weapon layers without a detail query', async () => {
    const own = harness('weapons');
    expect(own.wrapper.text()).toContain('测试用途，500');
    own.show(true);
    await flushPromises();
    const icon = own.wrapper.findComponent({ name: 'ImmersiveWeaponIcon' });
    expect(icon.props('mountType')).toBe('ENERGY');
    expect(icon.props('layers')[0].resource.relPath).toBe('weapon.png');
    expect(media.replace).not.toHaveBeenCalled();
    expect(media.query).not.toHaveBeenCalled();
    own.show(false);
    await flushPromises();
    expect(media.replace).not.toHaveBeenCalled();
    own.wrapper.unmount();
  });
  it('renders wing formation from the catalog preview without querying the candidate', async () => {
    const own = harness('wings');
    own.show(true);
    await flushPromises();
    const scene = own.wrapper.findComponent({ name: 'ImmersiveHullThumbnail' });
    expect(scene.props('wingLayout').points).toHaveLength(3);
    expect(scene.props('wingLayout').points[0].y).toBeCloseTo(11.88);
    expect(scene.props('variant').spec.hullId).toBe('sarissa');
    expect(media.query).not.toHaveBeenCalled();
    own.wrapper.unmount();
  });
});
