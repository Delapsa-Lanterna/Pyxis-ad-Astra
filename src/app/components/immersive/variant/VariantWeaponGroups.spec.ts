import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { h, ref, shallowRef } from 'vue';
import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import { variantJointFixture } from '@/test/variant-joint-edit';
import { projectVariantPanel } from '@/domain/immersive/variant/variant-panel';
import { jointObject } from '@/domain/joint-edit';
import type { JointValue } from '@/shared/types';
import type { useImmersiveVariantEditor } from '@/app/composables/immersive-editor/variant/use-immersive-variant-editor';
import VariantWeaponGroups from './VariantWeaponGroups.vue';
vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({ error: vi.fn(), warning: vi.fn(), choose: vi.fn().mockResolvedValue('local') }),
}));
const media = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('@/app/composables/use-resource-media-registry', () => ({
  useResourceMediaRegistry: () => ({ replaceCollection: media.replace, dataUrl: () => '' }),
}));
afterEach(() => vi.clearAllMocks());
function harness() {
  const snapshot = variantJointFixture(),
    values = shallowRef<Record<string, JointValue>>({ variant: snapshot.records.find((record) => record.key === 'variant')!.value });
  const snapshotRef = shallowRef(snapshot);
  const inputs = createFieldInputs(ref('variant'));
  const applyVariantAction = vi.fn(
    (key: string, transform: (data: Readonly<import('@/shared/types').RowData>) => import('@/shared/types').RowData) => {
      values.value = { ...values.value, [key]: { state: 'present', value: transform(jointObject(values.value[key])) } };
    },
  );
  const vm = {
    snapshot: snapshotRef,
    joint: { draftValue: values, currentTarget: ref(snapshot.root) },
    applyVariantAction,
  } as unknown as ReturnType<typeof useImmersiveVariantEditor>;
  const wrapper = mount(
    {
      setup() {
        provideFieldInputs(inputs);
        return () =>
          h(VariantWeaponGroups, { recordKey: 'variant', variant: projectVariantPanel(snapshot, values.value).variants[0]!, vm });
      },
    },
    { global: { stubs: { ImmersiveText: { props: ['text'], template: '<span>{{text}}</span>' } } } },
  );
  return { wrapper, inputs, applyVariantAction, values, vm, snapshotRef, group: wrapper.findComponent(VariantWeaponGroups) };
}
describe('variant weapon group confirmation', () => {
  it('registers available frame and toggle media together while keeping fallback controls usable', async () => {
    const own = harness();
    for (const key of ['toggle20_on', 'toggle20_off', 'ui_border1_top_left'])
      own.vm.snapshot.value!.referenceSettings.resources[key] = {
        source: 'core',
        ownerKind: 'ship',
        ownerId: 'refit-ui',
        relPath: key + '.png',
        key,
      };
    own.snapshotRef.value = {
      ...own.vm.snapshot.value!,
      referenceSettings: {
        ...own.vm.snapshot.value!.referenceSettings,
        resources: { ...own.vm.snapshot.value!.referenceSettings.resources },
      },
    };
    await flushPromises();
    expect(media.replace).toHaveBeenLastCalledWith(own.vm.joint.currentTarget.value!.sessionId, 'weapon-groups', [
      expect.objectContaining({ key: 'toggle20_on' }),
      expect.objectContaining({ key: 'toggle20_off' }),
      expect.objectContaining({ key: 'ui_border1_top_left' }),
    ]);
    expect(own.wrapper.find('.immersive-game-frame').classes()).not.toContain('textured');
    expect(own.wrapper.find('[role=checkbox]').classes()).toContain('fallback');
    expect(own.wrapper.find('.variant-group-resource-note').exists()).toBe(false);
    own.wrapper.unmount();
  });
  it('keeps edits in the input owner and cancels without a history action', async () => {
    const own = harness();
    await flushPromises();
    await own.wrapper.find('[role=checkbox]').trigger('click');
    expect(own.inputs.dirty.value).toBe(true);
    expect(own.applyVariantAction).not.toHaveBeenCalled();
    await own.wrapper.findAll('.variant-group-actions button')[1]!.trigger('click');
    expect(own.inputs.dirty.value).toBe(false);
    expect(own.applyVariantAction).not.toHaveBeenCalled();
    own.wrapper.unmount();
  });
  it('submits one combined action when saving active adjustments', async () => {
    const own = harness();
    await flushPromises();
    await own.wrapper.find('[role=checkbox]').trigger('click');
    await own.inputs.commit();
    expect(own.applyVariantAction).toHaveBeenCalledTimes(1);
    const groups = jointObject(own.values.value.variant).weaponGroups as import('@/shared/types').RowData[];
    expect(groups).toHaveLength(7);
    expect(groups[0]!.autofire).toBe(true);
    expect(own.group.emitted('close')).toHaveLength(1);
    own.wrapper.unmount();
  });
  it('rejects a changed grouping baseline and preserves local adjustments', async () => {
    const own = harness();
    await flushPromises();
    await own.wrapper.find('[role=checkbox]').trigger('click');
    own.values.value = { variant: { state: 'present', value: { ...jointObject(own.values.value.variant), weaponGroups: [] } } };
    await expect(own.inputs.commit()).rejects.toThrow('分组来源已变化');
    expect(own.inputs.dirty.value).toBe(true);
    expect(own.applyVariantAction).not.toHaveBeenCalled();
    own.wrapper.unmount();
  });
  it('registers exactly one action on explicit confirmation', async () => {
    const own = harness();
    await flushPromises();
    await own.wrapper.find('[role=checkbox]').trigger('click');
    await own.wrapper.findAll('.variant-group-actions button')[0]!.trigger('click');
    await flushPromises();
    expect(own.applyVariantAction).toHaveBeenCalledTimes(1);
    expect(own.group.emitted('close')).toHaveLength(1);
    own.wrapper.unmount();
  });
  it('shows seven square columns, all fitted weapons, empty modes and three flux values', async () => {
    const own = harness();
    await flushPromises();
    expect(own.wrapper.findAll('[role=checkbox]')).toHaveLength(7);
    expect(own.wrapper.findAll('[role=radio]')).toHaveLength(14);
    expect(own.wrapper.findAll('.variant-group-summary-row')).toHaveLength(7);
    expect(own.wrapper.findAll('.variant-group-summary-row')[6]!.text()).toContain('---');
    expect(own.wrapper.find('.variant-group-budget').text()).toContain('护盾幅能/秒400');
    expect(own.wrapper.find('.variant-weapon-groups').attributes('style')).toContain('461px');
    await own.wrapper.findAll('.variant-group-actions button')[0]!.trigger('click');
    await flushPromises();
    expect(own.applyVariantAction).not.toHaveBeenCalled();
    own.wrapper.unmount();
  });
  it('moves a Shift batch into group seven and commits all memberships together', async () => {
    const own = harness();
    await flushPromises();
    const row = own.wrapper.find('.variant-group-weapon-row');
    await row.trigger('mouseenter', { shiftKey: true });
    expect(own.wrapper.findAll('.variant-group-weapon-row.highlighted')).toHaveLength(2);
    await row.findAll('[role=radio]')[6]!.trigger('click', { shiftKey: true });
    expect(own.inputs.dirty.value).toBe(true);
    expect(own.applyVariantAction).not.toHaveBeenCalled();
    const last = own.wrapper.findAll('.variant-group-summary-row')[6]!;
    expect(last.text()).toContain('800');
    await last.trigger('mouseenter');
    expect(own.wrapper.findAll('.variant-group-weapon-row.highlighted')).toHaveLength(2);
    await last.trigger('click');
    expect(last.text()).toContain('交替');
    await own.inputs.commit();
    const groups = jointObject(own.values.value.variant).weaponGroups as import('@/shared/types').RowData[];
    expect(groups[6]).toMatchObject({ mode: 'ALTERNATING', weapons: { WS1: 'chaingun', WS2: 'chaingun' } });
    expect(own.applyVariantAction).toHaveBeenCalledTimes(1);
    own.wrapper.unmount();
  });
  it('keeps empty group clicks equal and cancels active changes with Escape', async () => {
    const own = harness();
    await flushPromises();
    await own.wrapper.findAll('.variant-group-summary-row')[6]!.trigger('click');
    expect(own.inputs.dirty.value).toBe(false);
    await own.wrapper.find('[role=checkbox]').trigger('click');
    await own.wrapper.find('[role=dialog]').trigger('keydown', { key: 'Escape' });
    expect(own.inputs.dirty.value).toBe(false);
    expect(own.applyVariantAction).not.toHaveBeenCalled();
    expect(own.group.emitted('close')).toHaveLength(1);
    own.wrapper.unmount();
  });
});
