import { mount, flushPromises } from '@vue/test-utils';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { variantJointFixture } from '@/test/fixtures/joint-edit/variant-joint-edit';
import { projectVariantPanel } from '@/domain/immersive/variant/variant-panel';
import { jointObject } from '@/domain/joint-edit';
import VariantCandidateDetails from './VariantCandidateDetails.vue';
const query = vi.hoisted(() => vi.fn());
vi.mock('@/services/joint-edit.service', () => ({ queryJointCandidate: query }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));
vi.mock('@/app/composables/use-resource-media-registry', () => ({
  useResourceMediaRegistry: () => ({ clear: vi.fn(), replaceCollection: vi.fn(), dataUrl: () => '' }),
}));
afterEach(() => vi.clearAllMocks());
describe('module candidate readonly information', () => {
  it('uses the current module draft then reads only the hovered saved candidate', async () => {
    const snapshot = variantJointFixture();
    const values = Object.fromEntries(snapshot.records.map((record) => [record.key, record.value]));
    values.variant = { state: 'present', value: { ...jointObject(values.variant), fluxCapacitors: 10 } };
    query.mockResolvedValue(snapshot);
    const own = mount(VariantCandidateDetails, {
      props: {
        root: snapshot.root,
        kind: 'variants',
        id: 'current',
        currentSnapshot: snapshot,
        currentValues: values,
        currentVariant: projectVariantPanel(snapshot, values).variants[0],
        currentRender: { mode: 'readonly', root: snapshot.root, records: snapshot.records, mediaUrl: () => '' },
      },
      global: {
        stubs: {
          ImmersiveText: { props: ['text'], template: '<span>{{text}}</span>' },
          ShipImmersivePanel: {
            props: ['panel', 'render'],
            template: '<article>{{panel.combat.map(stat => stat.display).join(" ")}} {{render.mode}}</article>',
          },
        },
      },
    });
    await flushPromises();
    expect(query).not.toHaveBeenCalled();
    expect(own.get('article').text()).toContain('13000');
    await own.setProps({ id: 'candidate', currentVariant: undefined });
    await flushPromises();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toMatchObject({ kind: 'variant', id: 'candidate' });
    expect(own.get('article').text()).toContain('11800');
    expect(own.get('article').text()).toContain('readonly');
    own.unmount();
  });
});
