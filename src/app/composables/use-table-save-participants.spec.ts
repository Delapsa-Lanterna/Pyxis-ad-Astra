import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTableSaveParticipants } from './use-table-save-participants';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useProjectStore } from '@/stores/project.store';
import { useTablesStore } from '@/stores/tables.store';
import { useEditTargetHandoff } from './use-edit-target-handoff';
import { sessionUpdateFixture } from '@/test/write-result';
import type { AppFeedback } from '@/shared/types';
const mocks = vi.hoisted(() => ({
  save: vi.fn(async () => ({ status: 'noop' })),
  retry: vi.fn(async () => {}),
  registration: vi.fn<(targets: unknown) => Promise<void>>().mockResolvedValue(undefined),
  error: vi.fn(),
}));
vi.mock('@/services/window.service', () => ({ updateEditTargetRegistration: mocks.registration }));
vi.mock('@/orchestrators/edit-target-handoff.orchestrator', () => ({ listenEditTargetHandoff: async () => () => {} }));
vi.mock('@/orchestrators/table-save.orchestrator', () => ({ saveTableChanges: mocks.save, pendingTableSave: () => null }));
vi.mock('@/orchestrators/project-sync.orchestrator', () => ({ retryPendingModSyncs: mocks.retry }));
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
describe('all loaded CSV save participants', () => {
  it('registers complete wire targets and releases them when the Mod is removed', async () => {
    const wrapper = mount({
      setup() {
        useEditTargetHandoff({
          error: mocks.error,
          success: vi.fn(),
          info: vi.fn(),
          warning: vi.fn(),
          confirmWarning: vi.fn(),
          confirmDanger: vi.fn(),
          choose: async () => null,
        });
        useTableSaveParticipants({} as AppFeedback, async () => []);
        return () => null;
      },
    });
    const update = sessionUpdateFixture('s', 'M:/mod');
    if (update.status !== 'ready') throw new Error('ready fixture');
    const manifest = update.projection.manifest;
    const project = useProjectStore();
    project.registerProjectManifest(manifest);
    await flushPromises();
    useTablesStore().initializeModTables({ sessionId: 's', modRoot: 'M:/mod', manifest });
    await flushPromises();
    const captured = JSON.parse(JSON.stringify(useSaveCommandStore().editTargets));
    expect(captured).toHaveLength(14);
    project.removeProjectManifest('M:/mod');
    await flushPromises();
    expect(mocks.registration.mock.calls.map(([targets]) => JSON.parse(JSON.stringify(targets)))).toEqual([[], captured, []]);
    expect(mocks.error).not.toHaveBeenCalled();
    wrapper.unmount();
    await flushPromises();
  });
  it('keeps captured targets valid while manifest removal awaits participant cleanup', async () => {
    const update = sessionUpdateFixture('s', 'M:/mod');
    if (update.status !== 'ready') throw new Error('ready fixture');
    const manifest = update.projection.manifest;
    manifest.tableSummaries.ships.path = 'data/hulls/ship_data.csv';
    const project = useProjectStore();
    const tables = useTablesStore();
    project.registerProjectManifest(manifest);
    tables.initializeModTables({ sessionId: 's', modRoot: 'M:/mod', manifest });
    const wrapper = mount({
      setup() {
        useTableSaveParticipants({} as AppFeedback, async () => []);
        return () => null;
      },
    });
    const commands = useSaveCommandStore();
    const captured = JSON.parse(JSON.stringify(commands.editTargets));
    project.removeProjectManifest('M:/mod');
    expect(JSON.parse(JSON.stringify(commands.editTargets))).toEqual(captured);
    await flushPromises();
    expect(commands.editTargets).toEqual([]);
    wrapper.unmount();
  });
  it('registers CSV participants when table initialization follows manifest registration', async () => {
    const wrapper = mount({
      setup() {
        useTableSaveParticipants({} as AppFeedback, async () => []);
        return () => null;
      },
    });
    const update = sessionUpdateFixture('s', 'M:/mod');
    if (update.status !== 'ready') throw new Error('ready fixture');
    const manifest = update.projection.manifest;
    manifest.tableSummaries.ships.path = 'data/hulls/ship_data.csv';
    const project = useProjectStore();
    const tables = useTablesStore();
    const commands = useSaveCommandStore();
    const target = { sessionId: 's', modRoot: 'M:/mod', path: 'M:/mod/data/hulls/ship_data.csv' };
    project.registerProjectManifest(manifest);
    await flushPromises();
    tables.initializeModTables({ sessionId: 's', modRoot: 'M:/mod', manifest });
    await flushPromises();
    expect(commands.participantsForTargets([target])).toHaveLength(1);
    const participant = commands.participantsForTargets([target])[0]!;
    const inputs = tables.getTableInputs('M:/mod', 'ships');
    const rawDirty = ref(true);
    const commit = vi.fn(() => {
      rawDirty.value = false;
      return null;
    });
    inputs.register({ key: 'name', label: '名称', dirty: rawDirty, commit, cancel: () => {}, focus: () => {} });
    expect(participant.editing!.dirty.value).toBe(true);
    await participant.editing!.draftSession.inputs.commit();
    expect(commit).toHaveBeenCalledOnce();
    expect(participant.editing!.dirty.value).toBe(false);
    const release = commands.holdParticipants([participant], 'keep-lock');
    project.replaceProjectManifest({ ...manifest }, 1);
    await flushPromises();
    expect(commands.participantsForTargets([target])[0]).toBe(participant);
    expect(commands.isEditTargetLocked(participant.targetKey.value)).toBe(true);
    release();
    tables.removeModState('M:/mod');
    await flushPromises();
    expect(commands.participantsForTargets([target])).toHaveLength(0);
    wrapper.unmount();
  });
  it('registers a background table, submits its input and saves its captured manifest', async () => {
    const update = sessionUpdateFixture('s', 'M:/mod');
    if (update.status !== 'ready') throw new Error('ready fixture');
    const manifest = update.projection.manifest;
    manifest.tableSummaries.weapons.path = 'data/weapons/weapon_data.csv';
    useProjectStore().registerProjectManifest(manifest);
    useTablesStore().initializeModTables({ sessionId: 's', modRoot: 'M:/mod', manifest });
    const feedback = {} as AppFeedback;
    const selected = vi.fn(async () => []);
    const wrapper = mount({
      setup() {
        useTableSaveParticipants(feedback, selected);
        return () => null;
      },
    });
    await flushPromises();
    const commands = useSaveCommandStore();
    const participants = commands.participantsForTargets([
      { sessionId: 's', modRoot: 'M:/mod', path: 'M:/mod/data/weapons/weapon_data.csv' },
    ]);
    expect(participants).toHaveLength(1);
    const handle = participants[0]!;
    await handle.editing!.save();
    expect(mocks.save).toHaveBeenCalledWith({ table: 'weapons', manifest, selectAssociatedSpecs: selected, feedback });
    const release = commands.holdParticipants(participants, 'request');
    expect(useTablesStore().isTableLocked('M:/mod', 'weapons')).toBe(true);
    release();
    expect(useTablesStore().isTableLocked('M:/mod', 'weapons')).toBe(false);
    wrapper.unmount();
    expect(commands.participantsForTargets(handle.editing!.targets.value)).toEqual([]);
  });
});
