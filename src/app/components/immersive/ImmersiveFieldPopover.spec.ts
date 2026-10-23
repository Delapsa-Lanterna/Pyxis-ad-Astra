import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { h, ref, shallowRef } from 'vue';
import { NInput } from 'naive-ui/es/input';
import { NSelect } from 'naive-ui/es/select';
import { NButton } from 'naive-ui/es/button';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import { shipJointFixture } from '@/test/ship-joint-edit';
import { jointFixtureValues } from '@/test/joint-record';
import { projectShipPanel } from '@/domain/immersive/ship/ship-panel';
import { updateImmersiveField, type ImmersiveFieldChange } from '@/domain/immersive/fields';
import ImmersiveFieldPopover from './ImmersiveFieldPopover.vue';
const feedback = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => feedback }));
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture({ theme: 'dark' }));
  vi.clearAllMocks();
});
function harness(id = 'hitpoints', missing = false) {
  const snapshot = shipJointFixture();
  const values = shallowRef(jointFixtureValues(snapshot));
  const active = ref(true);
  if (missing && values.value.csv?.state === 'present') delete (values.value.csv.value as Record<string, unknown>).hitpoints;
  const inputs = createFieldInputs(ref('ship'));
  const stat = projectShipPanel(snapshot, values.value).allStats.find((stat) => stat.id === id)!;
  const wrapper = mount(
    {
      setup() {
        provideFieldInputs(inputs);
        return () =>
          h(ImmersiveFieldPopover, {
            stat,
            snapshot,
            values: values.value,
            active: active.value,
            runtimeContext: { sessionId: 's', modRoot: 'M:/mod' },
            onUpdate: (changes: ImmersiveFieldChange[]) => {
              for (const { field, update } of changes) {
                values.value = updateImmersiveField(
                  values.value,
                  snapshot.records.find((record) => record.key === field.recordKey)!,
                  field,
                  update,
                );
              }
            },
            onClose: () => {
              active.value = false;
            },
          });
      },
    },
    { global: { components: { NInput, NSelect, NButton } } },
  );
  return { wrapper, inputs, values, active };
}
describe('immersive raw field popover', () => {
  it('retains every raw field and applies one complete batch after a later field is corrected', async () => {
    const own = harness('crew');
    await flushPromises();
    const fields = own.wrapper.findAll('input');
    await fields[0]!.setValue('30');
    await fields[1]!.setValue('1e');
    await expect(own.inputs.commit()).rejects.toThrow();
    expect(own.values.value.csv).toMatchObject({ state: 'present', value: { 'min crew': '25', 'max crew': '50' } });
    expect(fields[0]!.element.value).toBe('30');
    expect(own.inputs.dirty.value).toBe(true);
    await fields[1]!.setValue('60');
    await own.inputs.commit();
    expect(own.values.value.csv).toMatchObject({ state: 'present', value: { 'min crew': '30', 'max crew': '60' } });
    expect(own.inputs.dirty.value).toBe(false);
    own.wrapper.unmount();
  });
  it('cancels the complete pending batch after a validation failure', async () => {
    const own = harness('crew');
    await flushPromises();
    const fields = own.wrapper.findAll('input');
    await fields[0]!.setValue('30');
    await fields[1]!.setValue('1e');
    await expect(own.inputs.commit()).rejects.toThrow();
    await fields[1]!.trigger('keydown', { key: 'Escape' });
    expect(own.values.value.csv).toMatchObject({ state: 'present', value: { 'min crew': '25', 'max crew': '50' } });
    expect(own.inputs.dirty.value).toBe(false);
    own.wrapper.unmount();
  });
  it('lets the IME complete a text candidate before Enter submits the field', async () => {
    const own = harness('name');
    await flushPromises();
    await own.wrapper.find('input').setValue('中文舰船');
    await own.wrapper.find('input').trigger('keydown', { key: 'Enter', isComposing: true });
    await flushPromises();
    expect(own.active.value).toBe(true);
    expect(own.values.value.csv).toMatchObject({ state: 'present', value: { name: 'Lasher' } });
    await own.wrapper.find('input').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(own.values.value.csv).toMatchObject({ state: 'present', value: { name: '中文舰船' } });
    own.wrapper.unmount();
  });
  it('commits a numeric source through the input registry on Enter', async () => {
    const own = harness();
    await flushPromises();
    await own.wrapper.find('input').setValue('2000');
    expect(own.inputs.dirty.value).toBe(true);
    await own.wrapper.find('input').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(own.values.value.csv).toMatchObject({ state: 'present', value: { hitpoints: '2000' } });
    expect(own.active.value).toBe(false);
    own.wrapper.unmount();
  });
  it('keeps invalid text and reports its source while submission is blocked', async () => {
    const own = harness();
    await flushPromises();
    await own.wrapper.find('input').setValue('1e');
    await own.wrapper.find('input').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(own.wrapper.find('input').element.value).toBe('1e');
    expect(own.values.value.csv).toMatchObject({ state: 'present', value: { hitpoints: '1750' } });
    expect(feedback.error).toHaveBeenCalledOnce();
    expect(own.active.value).toBe(true);
    own.wrapper.unmount();
  });
  it('cancels an explicit missing-field request without publishing a new column value', async () => {
    const own = harness('hitpoints', true);
    await flushPromises();
    expect(own.inputs.dirty.value).toBe(true);
    await own.wrapper.find('input').setValue('500');
    await own.wrapper.find('input').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(own.values.value.csv).toMatchObject({ state: 'present' });
    if (own.values.value.csv?.state === 'present') expect(own.values.value.csv.value).not.toHaveProperty('hitpoints');
    expect(own.inputs.dirty.value).toBe(false);
    own.wrapper.unmount();
  });
  it('edits all description segments and commits multiline original text on Ctrl+Enter', async () => {
    const own = harness('description');
    await flushPromises();
    expect(own.wrapper.findAll('textarea')).toHaveLength(5);
    await own.wrapper.findAll('textarea')[0]!.setValue('第一段\n第二段');
    await own.wrapper.findAll('textarea')[0]!.trigger('keydown', { key: 'Enter', ctrlKey: true });
    await flushPromises();
    expect(own.values.value.description).toMatchObject({
      state: 'present',
      value: { text1: '第一段\n第二段', text2: 'second', text3: '', text4: '', text5: '' },
    });
    own.wrapper.unmount();
  });
});
