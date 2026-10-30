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
vi.mock('@/app/composables/use-original-fonts', () => ({
  useFontMeasurement: () => (runs: { text: string }[]) => runs.map((run) => run.text).join('').length * 5,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function harness(kind: 'weapons' | 'wings' | 'variants', visibility: { current?: boolean; active?: boolean } = { active: false }) {
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
      icon: { source: 'mod', relPath: 'hull.png', ownerKind: 'ship', ownerId: 'hull', key: 'sprite' },
      turretSprite: { source: 'mod', relPath: 'weapon.png', ownerKind: 'weapon', ownerId: 'candidate', key: 'turretSprite' },
    },
    data: { num: '3', formation: 'CLAW', range: '500' },
    spec: { type: 'ENERGY', size: 'SMALL' },
    primaryRole: '测试用途',
    moduleHull: { id: 'hull', name: 'Sample hull', hints: ['MODULE'] },
    projectile: null,
    preview: kind === 'wings' ? { hull: snapshot.hull!, spec: jointObject(snapshot.records[0]!.value), specs: [] } : null,
  };
  const wrapper = mount(VariantCandidateCard, {
    props: { root: snapshot.root, kind, entry, cost: 12, diagnostic: '', mediaUrl: () => '', ...visibility },
    global: {
      stubs: {
        ImmersiveText: { props: ['text'], template: '<span>{{text}}</span>' },
        ResourceThumbnail: { name: 'ResourceThumbnail', props: ['resource', 'width', 'height', 'active'], template: '<canvas/>' },
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
  it('uses a plain hull thumbnail and shows the module name, hull and complete ID', async () => {
    const own = harness('variants');
    expect(own.wrapper.text()).toContain('候选');
    expect(own.wrapper.text()).toContain('Sample hull');
    expect(own.wrapper.get('.variant-module-id').text()).toBe('candidate');
    const image = own.wrapper.findComponent({ name: 'ResourceThumbnail' });
    expect(image.props()).toMatchObject({ resource: { relPath: 'hull.png' }, width: 69, height: 69, active: false });
    await own.show(true);
    expect(image.props('active')).toBe(true);
    expect(media.query).not.toHaveBeenCalled();
    await own.wrapper.setProps({ entry: { ...own.entry, id: 'very_long_module_variant_identifier' } });
    expect(own.wrapper.get('.variant-module-id').text()).toContain('…');
    expect(own.wrapper.attributes('title')).toContain('very_long_module_variant_identifier');
    own.wrapper.unmount();
  });
  it.each(['weapons', 'wings'] as const)('shows the equipped %s preview when viewport visibility is omitted', (kind) => {
    const own = harness(kind, { current: true });
    expect(own.wrapper.find('canvas').exists()).toBe(true);
    own.wrapper.unmount();
  });
  it.each(['weapons', 'wings'] as const)('accepts the latest queued scroll visibility for %s', async (kind) => {
    const own = harness(kind);
    await own.showBatch([false, true]);
    await flushPromises();
    expect(own.wrapper.find('canvas').exists()).toBe(true);
    await own.showBatch([true, false]);
    await flushPromises();
    expect(own.wrapper.find('canvas').exists()).toBe(true);
    expect(own.wrapper.findComponent({ name: kind === 'weapons' ? 'ImmersiveWeaponIcon' : 'ImmersiveHullThumbnail' }).props('active')).toBe(
      false,
    );
    await own.showBatch([false, true, false, true]);
    await flushPromises();
    expect(own.wrapper.find('canvas').exists()).toBe(true);
    own.wrapper.unmount();
  });
  it('renders metadata immediately and acquires visible weapon layers without a detail query', async () => {
    const own = harness('weapons');
    expect(own.wrapper.text()).toContain('测试用途，500');
    await own.show(true);
    await flushPromises();
    const icon = own.wrapper.findComponent({ name: 'ImmersiveWeaponIcon' });
    expect(icon.props('mountType')).toBe('ENERGY');
    expect(icon.props('layers')[0].resource.relPath).toBe('weapon.png');
    expect(media.replace).not.toHaveBeenCalled();
    expect(media.query).not.toHaveBeenCalled();
    await own.show(false);
    await flushPromises();
    expect(media.replace).not.toHaveBeenCalled();
    own.wrapper.unmount();
  });
  it('renders wing formation from the catalog preview without querying the candidate', async () => {
    const own = harness('wings');
    await own.show(true);
    await flushPromises();
    const scene = own.wrapper.findComponent({ name: 'ImmersiveHullThumbnail' });
    expect(scene.props('wingLayout').points).toHaveLength(3);
    expect(scene.props('wingLayout').points[0].y).toBeCloseTo(11.88);
    expect(scene.props('variant').spec.hullId).toBe('sarissa');
    expect(media.query).not.toHaveBeenCalled();
    own.wrapper.unmount();
  });
});
