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
import { savedWriteFixture } from '@/test/fixtures/write-result';
import { useCsvEditorActions } from './use-csv-editor-actions';
import { mountSetup } from '@/test/unit/mount-setup';
import { entityTargetFixture } from '@/test/fixtures/entity-target';

enableAutoUnmount(afterEach);

const mocks = vi.hoisted(() => ({
  tables: { activeEditor: { save: vi.fn(), undo: vi.fn(), redo: vi.fn() } },
}));
vi.mock('@/stores/csv-editor.store', () => ({ useCsvEditorStore: () => mocks.tables }));

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

describe('CSV editor actions', () => {
  it('switches prepared choices without reading again and returns one batch or cancels', async () => {
    const feedback = feedbackStub();
    const { value: actions } = mountSetup(() => useCsvEditorActions(feedback));
    const target = entityTargetFixture('weapon', 'prepared');
    const file = { location: target.write, version: { path: target.write.path, fingerprint: 'base' }, problem: null };
    vi.mocked(feedback.choose).mockImplementationOnce(async (options) => {
      const content = options.content as () => import('vue').VNode;
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
    expect(await actions.selectAssociatedSpecs(choices)).toMatchObject([
      { change: { create: { id: 'prepared' } }, resolution: { mode: 'overwrite' } },
    ]);
    expect(feedback.choose).toHaveBeenCalledTimes(1);
    expect(await actions.selectAssociatedSpecs(choices)).toBeNull();
  });
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore(createSettingsFixture());
    vi.clearAllMocks();
    mocks.tables.activeEditor.undo.mockResolvedValue(true);
    mocks.tables.activeEditor.redo.mockResolvedValue(true);
  });

  it('returns the active document save result', async () => {
    const result = { status: 'saved', receipt: savedWriteFixture() };
    mocks.tables.activeEditor.save.mockResolvedValue(result);
    const { value: actions } = mountSetup(() => useCsvEditorActions(feedbackStub()));
    expect(await actions.save()).toEqual(result);
    expect(mocks.tables.activeEditor.save).toHaveBeenCalledOnce();
  });

  it('returns the adjusted weapon creation branch and selected actions from the confirmation', async () => {
    const feedback = feedbackStub();
    const { value: actions } = mountSetup(() => useCsvEditorActions(feedback));
    const select = actions.selectAssociatedSpecs;
    vi.mocked(feedback.choose).mockImplementationOnce(async (options: ChooseOptions) => {
      const content = options.content as () => import('vue').VNode;
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
    const { value: actions } = mountSetup(() => useCsvEditorActions(feedback));
    expect(await actions.selectAssociatedSpecs([])).toBeNull();
  });

  it('informs when there is nothing to save', async () => {
    mocks.tables.activeEditor.save.mockResolvedValue({ status: 'noop' });
    const feedback = feedbackStub();
    const { value: actions } = mountSetup(() => useCsvEditorActions(feedback));
    await actions.save();
    expect(feedback.info).toHaveBeenCalledWith('没有需要保存的修改');
  });
  it.each(['undo', 'redo'] as const)('delegates %s to the current document actions and reports rejection', async (direction) => {
    const feedback = feedbackStub();
    const { value: actions } = mountSetup(() => useCsvEditorActions(feedback));
    const action = direction === 'undo' ? actions.undoCurrentTableEdit : actions.redoCurrentTableEdit;
    await action();
    expect(mocks.tables.activeEditor[direction]).toHaveBeenCalledOnce();
    expect(feedback.error).not.toHaveBeenCalled();
    mocks.tables.activeEditor[direction].mockResolvedValueOnce(false);
    await action();
    expect(feedback.error).toHaveBeenCalledExactlyOnceWith(direction === 'undo' ? '撤销 CSV 编辑失败' : '重做 CSV 编辑失败');
  });
});
