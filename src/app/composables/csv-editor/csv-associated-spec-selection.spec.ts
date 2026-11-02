import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NCheckbox } from 'naive-ui/es/checkbox';
import { NSelect } from 'naive-ui/es/select';
import AppSelect from '@/app/components/AppSelect.vue';
import { installNaiveUi } from '@/app/naive-ui.runtime';
import type { ChooseOptions, AppFeedback } from '@/shared/types';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import type { VNode } from 'vue';
import { selectCsvAssociatedSpecs } from './csv-associated-spec-selection';
enableAutoUnmount(afterEach);

function feedbackStub(): AppFeedback {
  return {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  };
}
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  vi.clearAllMocks();
});
describe('CSV associated spec selection', () => {
  it.each([null, 'existing'])('presents rename resolution for destination version %s', async (fingerprint) => {
    const feedback = feedbackStub();
    const target = entityTargetFixture('ship', 'next');
    const source = entityTargetFixture('ship', 'source').write;
    const original = { location: source, version: { path: source.path, fingerprint: 'base' }, problem: null };
    const destination = { location: target.write, version: { path: target.write.path, fingerprint }, problem: null };
    vi.mocked(feedback.choose).mockImplementationOnce(async (options) => {
      expect(options.type).toBe(fingerprint ? 'warning' : 'info');
      expect(options.choices[0]!.type).toBe(fingerprint ? 'warning' : 'primary');
      const wrapper = mount({ render: options.content as () => VNode }, { global: { plugins: [installNaiveUi] } });
      await flushPromises();
      expect(wrapper.findAllComponents(AppSelect)).toHaveLength(fingerprint ? 1 : 0);
      expect(wrapper.text()).toContain(original.location.path);
      expect(wrapper.text()).toContain(target.write.path);
      expect(options.choices.map((choice) => choice.label)).toEqual(['保存']);
      wrapper.unmount();
      return 'save';
    });
    await selectCsvAssociatedSpecs(feedback, [
      {
        key: 'rename',
        table: 'ships',
        label: 'Rename',
        mode: fingerprint ? 'read' : 'overwrite',
        change: { action: 'rename', previousId: 'source', create: { kind: 'ship', id: 'next', hullName: 'Next' } },
        preparation: { target, baseVersions: [], original, destination },
      },
    ]);
  });
  it('switches prepared choices without reading again and returns one batch or cancels', async () => {
    const feedback = feedbackStub();
    const target = entityTargetFixture('weapon', 'prepared');
    const file = { location: target.write, version: { path: target.write.path, fingerprint: 'base' }, problem: null };
    vi.mocked(feedback.choose).mockImplementationOnce(async (options) => {
      const content = options.content as () => VNode;
      const wrapper = mount({ render: content }, { global: { plugins: [installNaiveUi] } });
      try {
        await flushPromises();
        expect(wrapper.text()).toContain(target.write.path);
        const selections = () => wrapper.findAllComponents(AppSelect).map((select) => select.findComponent(NSelect));
        expect(selections()[0]!.props('value')).toBe('read');
        expect(selections()).toHaveLength(2);
        selections()[0]!.vm.$emit('update:value', 'overwrite');
        await flushPromises();
        expect(selections()[0]!.props('value')).toBe('overwrite');
        expect(selections()).toHaveLength(3);
        wrapper.findAllComponents(NCheckbox)[1]!.vm.$emit('update:checked', false);
      } finally {
        wrapper.unmount();
      }
      return 'save';
    });
    const choices = ['prepared', 'other'].map((key) => ({
      key,
      table: 'weapons' as const,
      label: key,
      mode: 'read' as const,
      preparation: { target, baseVersions: [file.version], original: null, destination: file },
      change: { action: 'create' as const, create: { kind: 'weapon' as const, id: key, specClass: 'beam' as const } },
    }));
    expect(await selectCsvAssociatedSpecs(feedback, choices)).toMatchObject([
      { change: { create: { id: 'prepared' } }, resolution: { mode: 'overwrite' } },
    ]);
    expect(feedback.choose).toHaveBeenCalledTimes(1);
    expect(await selectCsvAssociatedSpecs(feedback, choices)).toBeNull();
  });
  it('returns the adjusted weapon creation branch and selected actions from the confirmation', async () => {
    const feedback = feedbackStub();
    const select = (candidates: Parameters<typeof selectCsvAssociatedSpecs>[1]) => selectCsvAssociatedSpecs(feedback, candidates);
    vi.mocked(feedback.choose).mockImplementationOnce(async (options: ChooseOptions) => {
      const content = options.content as () => VNode;
      const wrapper = mount({ render: content }, { global: { plugins: [installNaiveUi] } });
      try {
        await flushPromises();
        const select = wrapper.findAllComponents(AppSelect).at(-1)!.findComponent(NSelect);
        select.vm.$emit('update:value', 'beam');
        wrapper.findAllComponents(NCheckbox)[1]!.vm.$emit('update:checked', false);
        await flushPromises();
        expect(select.props('value')).toBe('beam');
      } finally {
        wrapper.unmount();
      }
      return 'save';
    });
    const chosen = await select([
      {
        key: 'create',
        table: 'weapons',
        label: '创建武器',
        change: { action: 'create', create: { kind: 'weapon', id: 'weapon', specClass: 'projectile' } },
        mode: 'overwrite',
        preparation: {
          target: entityTargetFixture('weapon', 'weapon', 'create'),
          baseVersions: [],
          original: null,
          destination: {
            location: entityTargetFixture('weapon', 'weapon', 'create').write,
            version: { path: 'M:/mod/data/weapons/weapon.wpn', fingerprint: null },
            problem: 'missing',
          },
        },
      },
      { key: 'delete', table: 'weapons', label: '删除武器', change: { action: 'delete', id: 'old' } },
    ]);
    expect(chosen).toMatchObject([
      { change: { action: 'create', create: { kind: 'weapon', id: 'weapon', specClass: 'beam' } }, resolution: { mode: 'overwrite' } },
    ]);
  });
  it('cancels the associated actions when the confirmation is dismissed', async () => {
    const feedback = feedbackStub();
    vi.mocked(feedback.choose).mockResolvedValueOnce(null);
    expect(await selectCsvAssociatedSpecs(feedback, [])).toBeNull();
  });
});
