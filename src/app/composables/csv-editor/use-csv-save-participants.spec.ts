import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref, watch } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCsvSaveParticipants } from './use-csv-save-participants';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useProjectStore } from '@/stores/project.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useEditTargetHandoff } from '@/app/composables/use-edit-target-handoff';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/write-result';
import type { AppFeedback } from '@/shared/types';
const mocks = vi.hoisted(() => ({
  save: vi.fn<typeof import('@/orchestrators/csv-save.orchestrator').saveCsvChanges>().mockResolvedValue({ status: 'noop' }),
  retry: vi.fn(async () => {}),
  registration: vi.fn<(targets: unknown) => Promise<void>>().mockResolvedValue(undefined),
  error: vi.fn(),
}));
vi.mock('@/services/window.service', () => ({ updateEditTargetRegistration: mocks.registration }));
vi.mock('@/orchestrators/edit-target-handoff.orchestrator', () => ({ listenEditTargetHandoff: async () => () => {} }));
vi.mock('@/orchestrators/csv-save.orchestrator', () => ({ saveCsvChanges: mocks.save, pendingCsvSave: () => null }));
vi.mock('@/orchestrators/project-sync.orchestrator', () => ({ retryPendingModSyncs: mocks.retry, completeSavedWrite: mocks.retry }));
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
describe('all loaded CSV save participants', () => {
  it.each([1, 2])('releases %i Mods while synchronous window status reads remain valid', async (modCount) => {
    const project = useProjectStore();
    const tables = useCsvEditorStore();
    const commands = useSaveCommandStore();
    const manifests = Array.from(
      { length: modCount },
      (_, index) => sessionUpdateFixture('s-' + index, 'M:/mod-' + index).projection.manifest,
    );
    for (const manifest of manifests) {
      project.registerProjectManifest(manifest);
      tables.initializeModTables({ sessionId: manifest.sessionId, modRoot: manifest.modRoot, manifest });
    }
    const wrapper = mount({
      setup() {
        useCsvSaveParticipants({} as AppFeedback, async () => []);
        watch(() => commands.hasPendingSave(), vi.fn(), { immediate: true, flush: 'sync' });
        return () => null;
      },
    });
    expect(commands.editTargets).toHaveLength(14 * modCount);
    const target = { sessionId: manifests[0]!.sessionId, modRoot: manifests[0]!.modRoot, table: 'ships' as const };
    tables.setSaving(target, true);
    expect(commands.hasPendingSave()).toBe(true);
    tables.setSaving(target, false);
    expect(commands.hasPendingSave()).toBe(false);
    for (const [index, manifest] of manifests.entries()) {
      expect(() => tables.removeModState(manifest.modRoot)).not.toThrow();
      project.removeProjectManifest(manifest.modRoot);
      await flushPromises();
      expect(commands.editTargets).toHaveLength(14 * (modCount - index - 1));
      expect(commands.hasPendingSave()).toBe(false);
      expect(tables.getCsvModState(manifest.modRoot)).toBeUndefined();
    }
    wrapper.unmount();
  });
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
        useCsvSaveParticipants({} as AppFeedback, async () => []);
        return () => null;
      },
    });
    const update = sessionUpdateFixture('s', 'M:/mod');
    if (update.status !== 'ready') throw new Error('ready fixture');
    const manifest = update.projection.manifest;
    const project = useProjectStore();
    project.registerProjectManifest(manifest);
    await flushPromises();
    useCsvEditorStore().initializeModTables({ sessionId: 's', modRoot: 'M:/mod', manifest });
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
    const tables = useCsvEditorStore();
    project.registerProjectManifest(manifest);
    tables.initializeModTables({ sessionId: 's', modRoot: 'M:/mod', manifest });
    const wrapper = mount({
      setup() {
        useCsvSaveParticipants({} as AppFeedback, async () => []);
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
        useCsvSaveParticipants({} as AppFeedback, async () => []);
        return () => null;
      },
    });
    const update = sessionUpdateFixture('s', 'M:/mod');
    if (update.status !== 'ready') throw new Error('ready fixture');
    const manifest = update.projection.manifest;
    manifest.tableSummaries.ships.path = 'data/hulls/ship_data.csv';
    const project = useProjectStore();
    const tables = useCsvEditorStore();
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
    const refreshed = { ...manifest, modInfo: { name: 'Refreshed' } };
    project.replaceProjectManifest(refreshed, 1);
    await flushPromises();
    expect(commands.participantsForTargets([target])[0]).toBe(participant);
    expect(commands.isEditTargetLocked(participant.targetKey.value)).toBe(true);
    release();
    await participant.editing!.save();
    expect(mocks.save).toHaveBeenLastCalledWith(expect.objectContaining({ manifest: refreshed }));
    tables.removeModState('M:/mod');
    await flushPromises();
    expect(commands.participantsForTargets([target])).toHaveLength(0);
    wrapper.unmount();
  });
  it('retains registrations across other Mods and replaces only a renewed table runtime', async () => {
    const project = useProjectStore(),
      tables = useCsvEditorStore(),
      commands = useSaveCommandStore();
    const first = sessionUpdateFixture('s', 'M:/mod');
    const second = sessionUpdateFixture('other', 'M:/other');
    if (first.status !== 'ready' || second.status !== 'ready') throw new Error('ready fixtures');
    const manifest = first.projection.manifest;
    manifest.tableSummaries.ships.path = 'data/hulls/ship_data.csv';
    project.registerProjectManifest(manifest);
    tables.initializeModTables({ sessionId: 's', modRoot: manifest.modRoot, manifest });
    const wrapper = mount({
      setup() {
        useCsvSaveParticipants({} as AppFeedback, async () => []);
        return () => null;
      },
    });
    const target = { sessionId: 's', modRoot: manifest.modRoot, path: manifest.modRoot + '/data/hulls/ship_data.csv' };
    const initial = commands.participantsForTargets([target])[0]!;
    project.registerProjectManifest(second.projection.manifest);
    tables.initializeModTables({ sessionId: 'other', modRoot: 'M:/other', manifest: second.projection.manifest });
    await flushPromises();
    expect(commands.editTargets).toHaveLength(28);
    expect(commands.participantsForTargets([target])).toEqual([initial]);
    tables.initializeModTables({ sessionId: 's', modRoot: manifest.modRoot, manifest });
    await flushPromises();
    expect(commands.editTargets).toHaveLength(28);
    expect(commands.participantsForTargets([target])[0]).not.toBe(initial);
    wrapper.unmount();
    expect(commands.editTargets).toHaveLength(0);
  });
  it('registers a background table, submits its input and saves its captured manifest', async () => {
    const update = sessionUpdateFixture('s', 'M:/mod');
    if (update.status !== 'ready') throw new Error('ready fixture');
    const manifest = update.projection.manifest;
    manifest.tableSummaries.weapons.path = 'data/weapons/weapon_data.csv';
    useProjectStore().registerProjectManifest(manifest);
    useCsvEditorStore().initializeModTables({ sessionId: 's', modRoot: 'M:/mod', manifest });
    const feedback = {} as AppFeedback;
    const selected = vi.fn(async () => []);
    const wrapper = mount({
      setup() {
        useCsvSaveParticipants(feedback, selected);
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
    expect(mocks.save).toHaveBeenCalledWith({
      table: 'weapons',
      manifest,
      selectAssociatedSpecs: selected,
      feedback,
      synchronize: expect.any(Function),
    });
    const release = commands.holdParticipants(participants, 'request');
    expect(useCsvEditorStore().isTableLocked('M:/mod', 'weapons')).toBe(true);
    release();
    expect(useCsvEditorStore().isTableLocked('M:/mod', 'weapons')).toBe(false);
    wrapper.unmount();
    expect(commands.participantsForTargets(handle.editing!.targets.value)).toEqual([]);
  });
  it('retries the table receipt with a single successful feedback and retained newer input', async () => {
    const manifest = sessionUpdateFixture('s', 'M:/mod').projection.manifest;
    const tables = useCsvEditorStore(),
      commands = useSaveCommandStore();
    useProjectStore().registerProjectManifest(manifest);
    tables.initializeModTables({ sessionId: 's', modRoot: manifest.modRoot, manifest });
    const feedback = { success: vi.fn() } as unknown as AppFeedback;
    const receipt = savedWriteFixture();
    mocks.retry.mockRejectedValueOnce(new Error('broadcast'));
    mocks.save.mockImplementationOnce(async (options) => {
      await options.synchronize!(receipt);
      return { status: 'saved', receipt };
    });
    const wrapper = mount({
      setup() {
        useCsvSaveParticipants(feedback, async () => []);
        return () => null;
      },
    });
    const handle = commands.participantsForTargets([{ sessionId: 's', modRoot: 'M:/mod', path: 'M:/mod/ships.csv' }])[0]!;
    await expect(commands.requestSave(handle)).rejects.toThrow('broadcast');
    const raw = ref(true);
    tables
      .getTableInputs('M:/mod', 'ships')
      .register({ key: 'name', label: 'Name', dirty: raw, commit: () => null, cancel: vi.fn(), focus: vi.fn() });
    expect(await commands.waitForSaves()).toBe(true);
    expect(handle.pendingSynchronization!.value).toBe(false);
    expect(raw.value).toBe(true);
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(feedback.success).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});
