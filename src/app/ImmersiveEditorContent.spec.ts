import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref, defineComponent, h } from 'vue';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createFieldInputs } from '@/shared/runtime/field-inputs';
import { createEditorProblems } from '@/shared/runtime/editor-problems';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { shipJointFixture } from '@/test/fixtures/joint-edit/ship-joint-edit';
import { jointFixtureValues } from '@/test/fixtures/joint-edit/joint-record';
import { projectShipPanel } from '@/domain/immersive/ship/ship-panel';
import { AppError } from '@/shared/lib/errors';
import ImmersiveEditorContent from './ImmersiveEditorContent.vue';

const mocks = vi.hoisted(() => ({ runtime: vi.fn(), error: vi.fn(), fileActions: vi.fn(), openFile: vi.fn() }));
vi.mock('@/app/composables/immersive-editor-assembly', () => ({
  useImmersiveEditorViewModel: mocks.runtime,
  editableRenderContext: () => ({}),
}));
vi.mock('@/windows/window-context.window', () => ({
  useWindowContext: () => ({ value: { identity: { sessionId: 's', modRoot: 'M:/mod', id: 'lasher', kind: 'ship' }, input: {} } }),
}));
vi.mock('@/app/composables/use-original-fonts', () => ({ provideOriginalFonts: vi.fn() }));
vi.mock('@/app/composables/use-managed-window-requests', () => ({ useManagedWindowRequests: vi.fn() }));
vi.mock('@/app/composables/use-window-close-state', () => ({ useWindowCloseParticipant: () => ({ install: async () => {} }) }));
vi.mock('@/app/composables/use-window-shortcuts', () => ({ useWindowShortcuts: vi.fn() }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error, fileActions: mocks.fileActions }) }));

let previousScroll: PropertyDescriptor | undefined;
beforeEach(() => {
  previousScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  vi.clearAllMocks();
  mocks.fileActions.mockReturnValue([{ label: '打开文件', type: 'error', run: mocks.openFile }]);
});
afterEach(() => {
  if (previousScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', previousScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});
function fixture() {
  const snapshot = shipJointFixture();
  const panel = projectShipPanel(snapshot, jointFixtureValues(snapshot));
  const key = ref('ship');
  const inputs = createFieldInputs(key);
  const problems = createEditorProblems(inputs);
  const selected = ref<string | null>(null);
  const toggleStat = vi.fn(async (id: string) => {
    selected.value = id;
  });
  const vm = {
    label: '舰船',
    root: snapshot.root,
    panel: ref(panel),
    snapshot: ref(snapshot),
    selectedStatId: selected,
    joint: {
      currentTarget: ref(snapshot.root),
      currentTargetKey: key,
      inputs,
      problems,
      dirty: ref(true),
      saving: ref(false),
      loading: ref(false),
      ready: ref(true),
      handoffLocked: ref(false),
      externalUpdateNotice: ref(''),
    },
    history: { canUndo: ref(true), canRedo: ref(false) },
    errorText: ref(''),
    referenceChanging: ref(false),
    variantActionPending: ref(false),
    isActive: () => key.value === 'ship',
    toggleStat,
  };
  mocks.runtime.mockReturnValue(vm);
  const wrapper = mount(ImmersiveEditorContent, {
    attachTo: document.body,
    global: {
      stubs: {
        NButton: true,
        ImmersiveEditorShell: { template: '<div><slot /></div>' },
        ShipImmersivePanel: defineComponent({
          setup: () => () =>
            h(
              'div',
              selected.value
                ? panel.allStats
                    .find((stat) => stat.id === selected.value)!
                    .fields.map((field) => h('label', { 'data-field-id': field.id }, h('input', { value: 'kept' })))
                : [],
            ),
        }),
      },
    },
  });
  return { wrapper, vm, panel, snapshot, problems, inputs, key, toggleStat };
}
describe('joint problem navigation', () => {
  it('uses the CSV row key to locate the second record sharing one file', async () => {
    const own = fixture();
    const first = own.snapshot.records.find((record) => record.key === 'csv')!;
    if (first.target.kind !== 'csv') throw new Error('CSV fixture');
    const second = { ...structuredClone(first), key: 'second', target: { ...first.target, rowKey: 'second-row' } };
    own.snapshot.records.push(second);
    const stat = structuredClone(own.panel.allStats.find((stat) => stat.id === 'hitpoints')!);
    stat.id = 'second/hitpoints';
    stat.fields = stat.fields.map((field) => ({ ...field, id: 'second/' + field.id, recordKey: 'second' }));
    own.panel.allStats.push(stat);
    try {
      own.problems.recordFailure(
        new AppError('Invalid', {
          code: 'csv.value_invalid',
          location: {
            path: second.target.write.path,
            rowKey: second.target.rowKey,
            field: 'hitpoints',
            line: null,
            column: null,
          },
        }),
      );
      await flushPromises();
      await own.wrapper.get('[role=button]').trigger('click');
      await flushPromises();
      expect(own.toggleStat).toHaveBeenCalledExactlyOnceWith('second/hitpoints', true);
      expect(document.activeElement).toBe(own.wrapper.get('input').element);
      expect(mocks.fileActions).not.toHaveBeenCalled();
    } finally {
      own.wrapper.unmount();
    }
  });
  it('sends a file failure with its original line and column to existing file actions', async () => {
    const own = fixture();
    const path = 'M:/mod/data/hulls/ship_data.csv';
    try {
      own.problems.recordFailure(
        new AppError('Source changed', { code: 'write.version_conflict', location: { path, line: 8, column: 3 } }),
      );
      await flushPromises();
      await own.wrapper.get('[role=button]').trigger('click');
      await flushPromises();
      expect(mocks.fileActions).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ path, line: 8, column: 3 }),
        'error',
        'write.version_conflict',
      );
      expect(mocks.openFile).toHaveBeenCalledOnce();
      expect(own.toggleStat).not.toHaveBeenCalled();
    } finally {
      own.wrapper.unmount();
    }
  });
  it('opens the existing statistic for the actual source record and focuses its field', async () => {
    const own = fixture();
    const stat = own.panel.allStats.find((stat) => stat.id === 'hitpoints')!;
    const record = own.snapshot.records.find((record) => record.key === stat.fields[0]!.recordKey)!;
    const path = record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path;
    try {
      own.problems.recordFailure(
        new AppError('Invalid field', {
          code: 'config.shape_invalid',
          location: {
            path,
            rowKey: record.target.kind === 'csv' ? record.target.rowKey : undefined,
            field: stat.fields[0]!.schema.key,
            line: null,
            column: null,
          },
        }),
      );
      await flushPromises();
      expect(own.wrapper.text()).toContain(path);
      await own.wrapper.get('[role=button]').trigger('click');
      await flushPromises();
      expect(own.toggleStat).toHaveBeenCalledExactlyOnceWith(stat.id, true);
      expect(document.activeElement).toBe(own.wrapper.get('input').element);
      expect(own.wrapper.get('input').element.value).toBe('kept');
      expect(mocks.error).not.toHaveBeenCalled();
    } finally {
      own.wrapper.unmount();
    }
  });
  it('locates registered raw input without committing it and rejects a late target focus', async () => {
    const own = fixture();
    const focus = vi.fn(),
      commit = vi.fn(() => null),
      dirty = ref(true);
    own.inputs.register({ key: 'raw', path: 'raw.path', label: 'Raw', dirty, validate: () => 'Invalid', commit, focus, cancel: vi.fn() });
    try {
      await flushPromises();
      await own.wrapper.get('[role=button]').trigger('click');
      expect(focus).toHaveBeenCalledOnce();
      expect(commit).not.toHaveBeenCalled();
      expect(dirty.value).toBe(true);
      own.inputs.release();
      const stat = own.panel.allStats.find((stat) => stat.id === 'hitpoints')!;
      const record = own.snapshot.records.find((record) => record.key === stat.fields[0]!.recordKey)!;
      const path = record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path;
      own.problems.recordFailure(
        new AppError('Invalid', {
          code: 'config.shape_invalid',
          location: {
            path,
            rowKey: record.target.kind === 'csv' ? record.target.rowKey : undefined,
            field: stat.fields[0]!.schema.key,
            line: null,
            column: null,
          },
        }),
      );
      own.toggleStat.mockImplementationOnce(async (id) => {
        own.vm.selectedStatId.value = id;
        own.key.value = 'other';
      });
      await flushPromises();
      await own.wrapper.get('[role=button]').trigger('click');
      await flushPromises();
      expect(document.activeElement).not.toBe(own.wrapper.get('input').element);
    } finally {
      own.wrapper.unmount();
    }
  });
});
