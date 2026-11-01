import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppSettings } from './use-app-lifecycle-assembly';
import { initializeSettings, flushSettings } from '@/orchestrators/settings-persistence.orchestrator';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { csvDraftRow } from '@/test/fixtures/csv-row';
import type { AppSettings, CsvTableTarget, AppFeedback, WindowFeedback } from '@/shared/types';

const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), listen: vi.fn(), stop: vi.fn(), committed: vi.fn() }));
vi.mock('@/services/app-settings.service', () => ({ readSettings: api.read, saveSettings: api.save, listenSettingsChanged: api.listen }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: vi.fn(), flushApplicationLogs: vi.fn() }));
vi.mock('@/orchestrators/file-history-replay.orchestrator', () => ({ refreshLoadedFileHistory: api.committed }));
let wrapper: VueWrapper | undefined,
  revision = 0;
const snapshot = (value = createSettingsFixture({ editHistoryLimit: 4 })) => ({
  revision: ++revision,
  value,
  performanceMonitorActive: false,
});
beforeEach(async () => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture({ editHistoryLimit: 4 }));
  api.read.mockResolvedValue(snapshot());
  api.listen.mockResolvedValue(api.stop);
  api.save.mockImplementation(async (value: AppSettings) => snapshot(value));
  await initializeSettings();
});
afterEach(() => {
  wrapper?.unmount();
  window.dispatchEvent(new Event('pagehide'));
});
function mountSettings(mode: 'main' | 'child') {
  wrapper = mount({
    setup() {
      useAppSettings(mode);
      return () => null;
    },
  });
}
function open(modRoot: string) {
  const manifest = sessionUpdateFixture(modRoot, modRoot).projection.manifest;
  useCsvEditorStore().initializeModTables({ sessionId: modRoot, modRoot, manifest });
  return (['ships', 'weapons'] as const).map((table) => ({ sessionId: modRoot, modRoot, table }));
}
const history = (target: CsvTableTarget) => useCsvEditorStore().getCsvModState(target.modRoot)!.documents[target.table].history;
const editor = (target: CsvTableTarget) =>
  useCsvEditorStore().bindSaveActions(target, {
    save: async () => ({ status: 'noop' }),
    waitForSave: async () => true,
    saving: ref(false),
  });
it.each(['main', 'child'] as const)('binds all histories and releases the %s window observer', async (mode) => {
  const csv = useCsvEditorStore(),
    settings = useSettingsStore();
  const targets = [...open('M:/first'), ...open('M:/second')];
  for (const target of targets) {
    csv.replaceTableForMod(target.modRoot, target.table, [csvDraftRow({ id: 'fixture', name: '0' }, 'row')]);
    for (let value = 1; value <= 4; value++) csv.updateCellValue({ ...target, rowKey: 'row', column: 'name' }, String(value));
    await editor(target).undo();
  }
  mountSettings(mode);
  expect(targets.every((target) => history(target).limit === 4)).toBe(true);
  settings.setEditHistoryLimit(1);
  for (const target of targets) {
    expect(history(target).undoStack).toHaveLength(1);
    expect(history(target).redoStack).toHaveLength(1);
    await editor(target).undo();
    expect(csv.getCsvModState(target.modRoot)!.documents[target.table].rows.row!.data.name).toBe('2');
    await editor(target).redo();
    await editor(target).redo();
    expect(csv.getCsvModState(target.modRoot)!.documents[target.table].rows.row!.data.name).toBe('4');
  }
  const next = open('M:/new');
  expect(next.every((target) => history(target).limit === 1)).toBe(true);
  settings.setEditHistoryLimit(6);
  expect([...targets, ...next].every((target) => history(target).limit === 6)).toBe(true);
  csv.clearCsvTableHistory(targets[0]!.modRoot, targets[0]!.table);
  expect(history(targets[0]!).limit).toBe(6);
  expect(history(targets[0]!).undoStack).toHaveLength(0);
  await flushPromises();
  wrapper!.unmount();
  settings.setEditHistoryLimit(2);
  expect(history(next[0]!).limit).toBe(6);
  mountSettings(mode);
  expect(history(next[0]!).limit).toBe(mode === 'main' ? 2 : 4);
});
it('keeps current capacity during a failed save and refreshes history after retry', async () => {
  const target = open('M:/save')[0]!;
  mountSettings('main');
  let fail!: (error: Error) => void;
  api.save.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  useSettingsStore().setEditHistoryLimit(1);
  expect(history(target).limit).toBe(1);
  await flushPromises();
  const ended = expect(flushSettings()).rejects.toThrow('fixture write');
  fail(new Error('fixture write'));
  await ended;
  expect(useSettingsStore().editHistoryLimit).toBe(1);
  expect(history(target).limit).toBe(1);
  expect(api.committed).not.toHaveBeenCalled();
  api.save.mockImplementationOnce(async (value: AppSettings) => snapshot({ ...value, editHistoryLimit: 2 }));
  await flushSettings();
  expect(api.committed).toHaveBeenCalledOnce();
  expect(history(target).limit).toBe(2);
});
it('accepts only newer child snapshots and stops mirror reception on unmount', () => {
  const target = open('M:/mirror')[0]!;
  mountSettings('child');
  const receive = api.listen.mock.calls[0]![0];
  const next = snapshot(createSettingsFixture({ editHistoryLimit: 2 }));
  receive(next);
  expect(history(target).limit).toBe(2);
  receive({ ...next, revision: next.revision - 1, value: createSettingsFixture({ editHistoryLimit: 8 }) });
  expect(history(target).limit).toBe(2);
  wrapper!.unmount();
  receive(snapshot(createSettingsFixture({ editHistoryLimit: 9 })));
  expect(useSettingsStore().editHistoryLimit).toBe(2);
  expect(history(target).limit).toBe(2);
  mountSettings('child');
  expect(history(target).limit).toBe(9);
});

it('provides application phase actions and the real participant factory to window content', async () => {
  const { h, onMounted } = await import('vue');
  const { useAppLifecycleAssembly } = await import('./use-app-lifecycle-assembly');
  const { provideAppFeedback } = await import('./use-app-feedback');
  const { useWindowCloseParticipant, useWindowCloseState } = await import('./use-window-close-state');
  const { mockIPC, mockWindows, clearMocks } = await import('@tauri-apps/api/mocks');
  const delivered: string[] = [];
  mockWindows('assembly-fixture');
  mockIPC((command, args) => {
    if (command === 'register_save_window') {
      const channel = (args as { channel: string }).channel;
      const runtime = Reflect.get(window, '__TAURI_INTERNALS__') as { runCallback: (id: number, data: unknown) => void };
      runtime.runCallback(Number(channel.split(':').at(-1)), { kind: 'references', snapshot: { revision: 1, sources: [], order: [] } });
    }
    if (command === 'ready_close') delivered.push(command);
    if (command === 'plugin:event|listen') return 7;
    return undefined;
  });
  const feedback = { error: vi.fn() } as unknown as AppFeedback;
  const Content = {
    setup() {
      expect(useWindowCloseState()!.value).toBe(false);
      const participant = useWindowCloseParticipant({ dirty: ref(false), title: 'Assembly fixture', content: 'Fixture' });
      onMounted(participant.install);
      return () => null;
    },
  };
  wrapper = mount({
    setup() {
      provideAppFeedback(feedback as WindowFeedback);
      useAppLifecycleAssembly(feedback);
      return () => h(Content);
    },
  });
  await flushPromises();
  expect(delivered).toEqual(['ready_close']);
  wrapper.unmount();
  await flushPromises();
  clearMocks();
});
