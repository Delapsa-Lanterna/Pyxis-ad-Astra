import { replaceCsvTableDraft, markCsvTableSavedDraft } from '@/domain/csv-editor/csv-table-draft';
import { csvRows } from '@/test/fixtures/csv-row';
import { csvDraftRow } from '@/test/fixtures/csv-row';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const writeCsvPatch = vi.hoisted(() => vi.fn());
const completeSavedWrite = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/services/csv-table.service', async () => ({
  ...(await vi.importActual('@/services/csv-table.service')),
  saveCsvPatch: writeCsvPatch,
  captureAssociatedSpecTarget: vi.fn(async (_session: string, _table: string, change: AssociatedSpecChange) => {
    const id = change.action === 'rename' ? change.previousId : change.action === 'delete' ? change.id : change.create.id;
    const target = entityTargetFixture('ship', id);
    return { target, nextWrite: target.write, versions: [] };
  }),
}));
vi.mock('@/services/window.service', () => ({
  reserveNativeWindowTargets: vi.fn(async () => {}),
  releaseNativeWindowTargets: vi.fn(async () => {}),
}));
vi.mock('@/orchestrators/project-sync.orchestrator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/orchestrators/project-sync.orchestrator')>()),
  completeSavedWrite,
}));

import type { ProjectInvalidation, ProjectManifest, WriteResult, AssociatedSpecChange } from '@/shared/types';
import { TABLE_KEYS } from '@/shared/types';
import { useProjectStore } from '@/stores/project.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { saveCsvChanges } from '@/orchestrators/csv-save.orchestrator';
import { ref } from 'vue';
import type { AssociatedSpecCandidate } from '@/domain/csv-editor/associated-spec-candidates';

import { useDraftSessionsStore } from '@/stores/draft-sessions.store';

const MOD_ROOT = 'M:\\test-mod';
const SESSION_ID = 'sess-1';
const rowKey = (index: number) => 'ships:row:' + index;

function buildManifest(overrides: Partial<ProjectManifest> = {}): ProjectManifest {
  return {
    baseVersions: [],
    sessionId: SESSION_ID,
    modRoot: MOD_ROOT,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: {},
    tableSummaries: Object.fromEntries(
      TABLE_KEYS.map((key) => [key, { path: `${key}.csv`, header: ['id', 'hullName'], available: key === 'ships', totalRows: 1 }]),
    ) as ProjectManifest['tableSummaries'],
    tableEntitySummaries: Object.fromEntries(TABLE_KEYS.map((key) => [key, 0])) as ProjectManifest['tableEntitySummaries'],
    entitySummaries: {
      factions: 0,
      missions: 0,
      ships: 0,
      weapons: 0,
      projectiles: 0,
      variants: 0,
      skins: 0,
      systems: 0,
      skills: 0,
    },
    warnings: [],
    ...overrides,
  };
}

function writeResult(overrides: Partial<WriteResult> = {}): WriteResult {
  const invalidation: ProjectInvalidation = { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false };
  return {
    sessionUpdates: [],
    baseVersions: [],
    commitId: 1,
    history: { revision: 1, undoStack: [], redoStack: [] },
    changes: [
      {
        beforePath: `${MOD_ROOT}\\ships.csv`,
        afterPath: `${MOD_ROOT}\\ships.csv`,
        kind: 'file',
        beforeExists: true,
        beforeText: '',
        beforeDataBase64: null,
        beforeFiles: [],
        afterExists: true,
        afterText: '',
        afterDataBase64: null,
        afterFiles: [],
      },
    ],
    invalidation,
    identityChanges: [],
    keyMap: [],
    content: null,
    ...overrides,
  };
}

function hydrateActiveTable() {
  const tables = useCsvEditorStore();
  const workspace = useWorkspaceStore();
  workspace.registerMod({ modRoot: MOD_ROOT, displayName: MOD_ROOT, version: '', status: 'ready' });
  workspace.activateModTable(MOD_ROOT);
  tables.initializeModTables({ sessionId: buildManifest().sessionId, modRoot: MOD_ROOT, manifest: buildManifest() });
  const state = tables.getCsvModState(MOD_ROOT);
  if (!state) throw new Error('table state missing after hydrate');
  replaceCsvTableDraft(state.documents.ships, [csvDraftRow({ id: 'npc1', hullName: 'A' }, 'ships:r1')]);
  return state;
}

describe('table-save orchestrator', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it.each(['none', 'undo', 'edit', 'create', 'delete'] as const)(
    'saves the captured order while preserving a later %s action',
    async (later) => {
      const manifest = buildManifest();
      manifest.associatedSpecTables = [];
      useProjectStore().manifests.set(MOD_ROOT, manifest);
      const state = hydrateActiveTable(),
        tables = useCsvEditorStore();
      replaceCsvTableDraft(
        state.documents.ships,
        ['a', 'b', 'c'].map((id, index) => csvDraftRow({ id }, `ships:row:${index}`)),
      );
      markCsvTableSavedDraft(state.documents.ships);
      state.documents.ships.totalRowCount = state.documents.ships.filteredRowCount = 3;
      const target = { sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships' as const };
      tables.moveRow(target, 'ships:row:2', 0);
      let finish!: (result: WriteResult) => void;
      writeCsvPatch.mockImplementationOnce(
        () =>
          new Promise<WriteResult>((resolve) => {
            finish = resolve;
          }),
      );
      const saving = saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] });
      expect(writeCsvPatch.mock.lastCall![7]).toEqual([2, 0, 1].map(rowKey));
      if (later === 'undo') await tables.activeEditor!.undo();
      if (later === 'edit') tables.updateCellValue({ ...target, rowKey: 'ships:row:1', column: 'id' }, 'edited');
      if (later === 'create') tables.addNewRow();
      if (later === 'delete') {
        tables.selectRowByKey(target, 'ships:row:0');
        tables.deleteSelected();
      }
      finish(writeResult());
      await saving;
      expect(csvRows(state, true).map((row) => row?.data.id)).toEqual(['c', 'a', 'b']);
      expect(state.documents.ships.baselineRowOrder).toEqual([2, 0, 1].map(rowKey));
      if (later === 'none') expect(tables.hasCurrentTableChanges).toBe(false);
      else expect(tables.hasCurrentTableChanges).toBe(true);
      if (later === 'undo') {
        expect(state.documents.ships.rowOrder).toEqual([0, 1, 2].map(rowKey));
        await tables.activeEditor!.redo();
        expect(tables.hasCurrentTableChanges).toBe(false);
      }
      if (later === 'edit') expect(csvRows(state)[2]?.data.id).toBe('edited');
      if (later === 'create') expect(csvRows(state)[1]!.rowKey).toContain(':new:');
      if (later === 'delete') expect(state.documents.ships.dirty['ships:row:0']).toEqual({ action: 'delete' });
    },
  );

  it('rebases a newly saved row and its later undo without replacing its identity', async () => {
    const manifest = buildManifest();
    manifest.associatedSpecTables = [];
    useProjectStore().manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable(),
      tables = useCsvEditorStore();
    replaceCsvTableDraft(
      state.documents.ships,
      ['a', 'b'].map((id, index) => csvDraftRow({ id }, `ships:row:${index}`)),
    );
    markCsvTableSavedDraft(state.documents.ships);
    state.documents.ships.totalRowCount = state.documents.ships.filteredRowCount = 2;
    tables.moveRow({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships' }, 'ships:row:1', 0);
    const added = tables.addNewRow()!;
    let finish!: (result: WriteResult) => void;
    writeCsvPatch.mockImplementationOnce(
      () =>
        new Promise<WriteResult>((resolve) => {
          finish = resolve;
        }),
    );
    const saving = saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] });
    await tables.activeEditor!.undo();
    finish(writeResult({ keyMap: [{ previousKey: added.rowKey, nextKey: 'ships:row:2', rowIndex: 1 }] }));
    await saving;
    expect(state.documents.ships.rowOrder).toEqual([1, 0].map(rowKey));
    expect(state.documents.ships.dirty['ships:row:2']).toEqual({ action: 'delete' });
    await tables.activeEditor!.redo();
    expect(state.documents.ships.rowOrder).toEqual([1, 2, 0].map(rowKey));
    expect(tables.hasCurrentTableChanges).toBe(false);
  });

  it('restores a submitted deletion as a new row when its undo also reverses the submitted order', async () => {
    const manifest = buildManifest();
    manifest.associatedSpecTables = [];
    useProjectStore().manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable(),
      tables = useCsvEditorStore();
    replaceCsvTableDraft(
      state.documents.ships,
      ['a', 'b', 'c'].map((id, index) => csvDraftRow({ id }, `ships:row:${index}`)),
    );
    markCsvTableSavedDraft(state.documents.ships);
    state.documents.ships.totalRowCount = state.documents.ships.filteredRowCount = 3;
    const target = { sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships' as const };
    tables.selectRowByKey(target, 'ships:row:0');
    tables.deleteSelected();
    tables.moveRow(target, 'ships:row:2', 0);
    let finish!: (result: WriteResult) => void;
    writeCsvPatch.mockImplementationOnce(
      () =>
        new Promise<WriteResult>((resolve) => {
          finish = resolve;
        }),
    );
    const saving = saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] });
    await tables.activeEditor!.undo();
    await tables.activeEditor!.undo();
    finish(writeResult());
    await saving;
    const restored = csvRows(state)[0]!;
    expect(restored.rowKey).toContain(':new:');
    expect(restored).toMatchObject({ data: { id: 'a' } });
    expect(state.documents.ships.rowOrder).toEqual([restored.rowKey, rowKey(1), rowKey(2)]);
    await tables.activeEditor!.redo();
    await tables.activeEditor!.redo();
    expect(state.documents.ships.rowOrder).toEqual([2, 1].map(rowKey));
    expect(tables.hasCurrentTableChanges).toBe(false);
  });

  it('keeps the insertion boundary of a later undone creation after an ordered save', async () => {
    const manifest = buildManifest();
    manifest.associatedSpecTables = [];
    useProjectStore().manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable(),
      tables = useCsvEditorStore();
    replaceCsvTableDraft(
      state.documents.ships,
      ['a', 'b', 'c'].map((id, index) => csvDraftRow({ id }, `ships:row:${index}`)),
    );
    markCsvTableSavedDraft(state.documents.ships);
    state.documents.ships.totalRowCount = state.documents.ships.filteredRowCount = 3;
    tables.moveRow({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships' }, 'ships:row:2', 0);
    let finish!: (result: WriteResult) => void;
    writeCsvPatch.mockImplementationOnce(
      () =>
        new Promise<WriteResult>((resolve) => {
          finish = resolve;
        }),
    );
    const saving = saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] });
    const pending = tables.addNewRow()!;
    await tables.activeEditor!.undo();
    finish(writeResult());
    await saving;
    await tables.activeEditor!.redo();
    expect(state.documents.ships.rowOrder[1]).toBe(pending.rowKey);
    expect(state.documents.ships.rowOrder).toEqual([rowKey(2), pending.rowKey, rowKey(0), rowKey(1)]);
  });

  it('saves middle insertions in displayed order after earlier rows are deleted', async () => {
    const manifest = buildManifest();
    manifest.associatedSpecTables = [];
    useProjectStore().manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable();
    state.documents.ships.header = ['id'];
    replaceCsvTableDraft(
      state.documents.ships,
      ['first', 'second', 'third'].map((id, index) => csvDraftRow({ id }, `ships:row:${index}`)),
    );
    markCsvTableSavedDraft(state.documents.ships);
    const tables = useCsvEditorStore();
    const target = { sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships' as const };
    tables.selectRowByKey(target, 'ships:row:1');
    const first = tables.addNewRow()!;
    tables.selectRowByKey(target, 'ships:row:1');
    const second = tables.addNewRow()!;
    tables.selectRowByKey(target, 'ships:row:0');
    tables.deleteSelected();
    writeCsvPatch.mockResolvedValueOnce(
      writeResult({
        keyMap: [
          { previousKey: second.rowKey, nextKey: 'ships:row:3', rowIndex: 1 },
          { previousKey: first.rowKey, nextKey: 'ships:row:4', rowIndex: 2 },
        ],
      }),
    );
    await saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] });
    expect(writeCsvPatch.mock.lastCall![3].map((patch: { rowKey: string }) => patch.rowKey)).toEqual([
      rowKey(0),
      first.rowKey,
      second.rowKey,
    ]);
    expect(writeCsvPatch.mock.lastCall![7]).toEqual([rowKey(1), second.rowKey, first.rowKey, rowKey(2)]);
    expect(csvRows(state).map((row) => row?.rowKey)).toEqual(['ships:row:1', 'ships:row:3', 'ships:row:4', 'ships:row:2']);
    expect(state.documents.ships.baselineRowOrder).toEqual(state.documents.ships.rowOrder);
    expect(state.documents.ships.dirty).toEqual({});
  });

  it('saves a filtered insertion after its physical source row', async () => {
    const manifest = buildManifest();
    manifest.associatedSpecTables = [];
    useProjectStore().manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable();
    state.documents.ships.header = ['id'];
    replaceCsvTableDraft(
      state.documents.ships,
      Array.from({ length: 13 }, (_, index) => csvDraftRow({ id: 'row-' + index }, rowKey(index))),
    );
    state.documents.ships.queryRowKeys = [rowKey(7), rowKey(12)];
    markCsvTableSavedDraft(state.documents.ships);
    const tables = useCsvEditorStore();
    tables.selectRowByKey({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships' }, 'ships:row:7');
    const created = tables.addNewRow()!;
    writeCsvPatch.mockResolvedValueOnce(writeResult({ keyMap: [{ previousKey: created.rowKey, nextKey: 'ships:row:20', rowIndex: 8 }] }));
    await saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] });
    expect(writeCsvPatch.mock.lastCall![7][8]).toBe(created.rowKey);
    expect(state.documents.ships.rowOrder[8]).toBe(rowKey(20));
    expect(state.documents.ships.rowOrder.indexOf(rowKey(12))).toBe(13);
  });

  it('preserves consecutive restored rows when multiple deletions are undone during saving', async () => {
    const manifest = buildManifest();
    manifest.associatedSpecTables = [];
    useProjectStore().manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable();
    state.documents.ships.header = ['id'];
    replaceCsvTableDraft(
      state.documents.ships,
      ['first', 'second', 'third'].map((id, index) => csvDraftRow({ id }, `ships:row:${index}`)),
    );
    markCsvTableSavedDraft(state.documents.ships);
    const tables = useCsvEditorStore();
    const target = { sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships' as const };
    for (const rowKey of ['ships:row:0', 'ships:row:1']) {
      tables.selectRowByKey(target, rowKey);
      tables.deleteSelected();
    }
    let finish!: (result: WriteResult) => void;
    writeCsvPatch.mockImplementationOnce(
      () =>
        new Promise<WriteResult>((resolve) => {
          finish = resolve;
        }),
    );
    const saving = saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] });
    await tables.activeEditor!.undo();
    await tables.activeEditor!.undo();
    finish(writeResult());
    await saving;
    expect(
      csvRows(state)
        .slice(0, 2)
        .every((row) => row!.rowKey.includes(':new:')),
    ).toBe(true);
    const restored = csvRows(state).slice(0, 2);
    const restoredKeys = restored.map((row) => row!.rowKey);
    writeCsvPatch.mockResolvedValueOnce(
      writeResult({
        keyMap: restored.map((row, index) => ({ previousKey: row!.rowKey, nextKey: `ships:row:${index + 3}`, rowIndex: index })),
      }),
    );
    await saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] });
    expect(writeCsvPatch.mock.lastCall![7]).toEqual([...restoredKeys, rowKey(2)]);
    expect(csvRows(state).map((row) => row?.data.id)).toEqual(['first', 'second', 'third']);
    expect(state.documents.ships.baselineRowOrder).toEqual(state.documents.ships.rowOrder);
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])('rebases a later insertion across saving, before: %s, undone: %s', async (before, undone) => {
    const manifest = buildManifest();
    manifest.associatedSpecTables = [];
    useProjectStore().manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable();
    state.documents.ships.header = ['id'];
    markCsvTableSavedDraft(state.documents.ships);
    const tables = useCsvEditorStore();
    const target = { sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships' as const };
    tables.selectRowByKey(target, 'ships:r1');
    const submitted = tables.addNewRow()!;
    let finish!: (result: WriteResult) => void;
    writeCsvPatch.mockImplementationOnce(
      () =>
        new Promise<WriteResult>((resolve) => {
          finish = resolve;
        }),
    );
    const saving = saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] });
    if (before) tables.selectRowByKey(target, 'ships:r1');
    const pending = tables.addNewRow()!;
    if (undone) await tables.activeEditor!.undo();
    finish(writeResult({ keyMap: [{ previousKey: submitted.rowKey, nextKey: 'ships:row:2', rowIndex: 1 }] }));
    await saving;
    if (undone) await tables.activeEditor!.redo();
    expect(state.documents.ships.rowOrder.indexOf(pending.rowKey)).toBe(before ? 1 : 2);
    await tables.activeEditor!.undo();
    await tables.activeEditor!.redo();
    expect(state.documents.ships.rowOrder.indexOf(pending.rowKey)).toBe(before ? 1 : 2);
    writeCsvPatch.mockResolvedValueOnce(
      writeResult({ keyMap: [{ previousKey: pending.rowKey, nextKey: 'ships:row:3', rowIndex: before ? 1 : 2 }] }),
    );
    await saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] });
    expect(writeCsvPatch.mock.lastCall![7][before ? 1 : 2]).toBe(pending.rowKey);
    expect(state.documents.ships.baselineRowOrder).toEqual(state.documents.ships.rowOrder);
  });

  it('captures the parser flag with the row and retains later comment changes through save and undo', async () => {
    const project = useProjectStore();
    const manifest = buildManifest();
    project.manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable();
    csvRows(state)[0]!.data.id = '#quoted';
    markCsvTableSavedDraft(state.documents.ships);
    const tables = useCsvEditorStore();
    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'Written');
    let finish!: (receipt: WriteResult) => void;
    writeCsvPatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const saving = saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] });
    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'id' }, '#disabled');
    finish(writeResult());
    await saving;
    expect(writeCsvPatch.mock.lastCall![3][0]).toMatchObject({ row: { id: '#quoted', hullName: 'Written' }, isComment: false });
    expect(csvRows(state, true)[0]).toMatchObject({ data: { id: '#quoted', hullName: 'Written' }, isComment: false });
    expect(csvRows(state)[0]).toMatchObject({ data: { id: '#disabled' }, isComment: true });
    expect(await tables.activeEditor!.undo()).toBeTruthy();
    expect(csvRows(state)[0]?.isComment).toBe(false);
    expect(state.documents.ships.dirty).toEqual({});
  });

  it('commits pending input before taking the CSV and history snapshot', async () => {
    const project = useProjectStore();
    const manifest = buildManifest();
    project.manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable();
    markCsvTableSavedDraft(state.documents.ships);
    const tables = useCsvEditorStore();
    const pendingDirty = ref(true);
    tables.getTableInputs(MOD_ROOT, 'ships').register({
      key: 'ships:r1/hullName',
      label: '舰名',
      dirty: pendingDirty,
      commit: () => {
        tables.updateCellValue(
          { sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' },
          'typed',
        );
        pendingDirty.value = false;
        return null;
      },
      focus: vi.fn(),
      cancel: vi.fn(),
    });
    expect(useDraftSessionsStore().hasUnsavedWorkForMod(MOD_ROOT)).toBe(true);
    expect(state.documents.ships.dirty).toEqual({});
    writeCsvPatch.mockResolvedValueOnce(writeResult());
    await saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] });
    expect(writeCsvPatch.mock.calls.at(-1)?.[3]).toEqual([
      { rowKey: 'ships:r1', action: 'upsert', isComment: false, row: { id: 'npc1', hullName: 'typed' } },
    ]);
    expect(useDraftSessionsStore().hasUnsavedWorkForMod(MOD_ROOT)).toBe(false);
  });

  it('keeps CSV, associated specs, credentials and history fixed while selection is pending', async () => {
    const project = useProjectStore();
    const manifest = buildManifest({ associatedSpecTables: ['ships'] });
    project.manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable();
    markCsvTableSavedDraft(state.documents.ships);
    state.documents.ships.baseVersions = [{ path: 'ships.csv', fingerprint: 'base' }];
    const tables = useCsvEditorStore();
    const cellTarget = { sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships' as const, rowKey: 'ships:r1', column: 'id' };
    tables.updateCellValue(cellTarget, 'submitted');
    let release!: (selection: AssociatedSpecChange[]) => void;
    let candidates!: AssociatedSpecCandidate[];
    const saving = saveCsvChanges({
      table: 'ships',
      manifest,
      selectAssociatedSpecs: (choices) => {
        candidates = choices;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    expect(tables.saving).toBe(true);
    tables.updateCellValue(cellTarget, 'later');
    state.documents.ships.baseVersions[0]!.fingerprint = 'later-version';
    await flushPromises();
    expect(candidates[0]?.change).toMatchObject({ create: { id: 'submitted' } });
    writeCsvPatch.mockResolvedValueOnce(writeResult());
    release(candidates.map((candidate) => candidate.change));
    await saving;
    const call = writeCsvPatch.mock.calls.at(-1)!;
    expect(call[3][0].row.id).toBe('submitted');
    expect(call[4][0].change.create.id).toBe('submitted');
    expect(call[6]).toEqual([{ path: 'ships.csv', fingerprint: 'base' }]);
    expect(csvRows(state)[0]?.data.id).toBe('later');
    expect(await tables.activeEditor!.undo()).toBeTruthy();
    expect(csvRows(state)[0]?.data.id).toBe('submitted');
    expect(tables.saving).toBe(false);
  });

  it('retains the input and ends preparation after a rejected commit', async () => {
    const project = useProjectStore();
    const manifest = buildManifest();
    project.manifests.set(MOD_ROOT, manifest);
    hydrateActiveTable();
    const tables = useCsvEditorStore();
    const focus = vi.fn();
    tables.getTableInputs(MOD_ROOT, 'ships').register({
      key: 'ships:r1/id',
      label: 'ID',
      dirty: ref(true),
      commit: () => '未完成',
      focus,
      cancel: vi.fn(),
    });
    await expect(saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] })).rejects.toMatchObject({
      action: 'commit-field-inputs',
    });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(writeCsvPatch).not.toHaveBeenCalled();
    expect(tables.saving).toBe(false);
    expect(tables.hasCurrentTableChanges).toBe(true);
  });

  it('is a noop when nothing is dirty', async () => {
    const tables = useCsvEditorStore();
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    tables.initializeModTables({ sessionId: buildManifest().sessionId, modRoot: MOD_ROOT, manifest: buildManifest() });

    const manifest = project.getManifest(MOD_ROOT);
    expect(await saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] })).toMatchObject({ status: 'noop' });
    expect(writeCsvPatch).not.toHaveBeenCalled();
    expect(completeSavedWrite).not.toHaveBeenCalled();
  });

  it('keeps the persisted baseline and receipt when post-save synchronization fails', async () => {
    const project = useProjectStore();
    const manifest = buildManifest();
    project.manifests.set(MOD_ROOT, manifest);
    const state = hydrateActiveTable();
    markCsvTableSavedDraft(state.documents.ships);
    const tables = useCsvEditorStore();
    const generation = tables.tableReadGeneration(MOD_ROOT, 'ships');
    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'Written');
    const result = writeResult({ baseVersions: [{ path: 'ships.csv', fingerprint: 'v2' }] });
    writeCsvPatch.mockResolvedValueOnce(result);
    completeSavedWrite.mockRejectedValueOnce(new Error('sync failed'));
    await expect(saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] })).rejects.toThrow('sync failed');
    expect(csvRows(state, true)[0]?.data.hullName).toBe('Written');
    expect(state.documents.ships.baseVersions).toEqual(result.baseVersions);
    expect(state.documents.ships.dirty).toEqual({});
    expect(tables.tableReadGeneration(MOD_ROOT, 'ships')).toBeGreaterThan(generation);
    expect(tables.saving).toBe(false);
    expect(result.keyMap).toEqual([]);
  });

  it('submits business content and accepts the saved row baseline', async () => {
    const tables = useCsvEditorStore();
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();

    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'B');
    expect(Object.keys(state.documents.ships.dirty).length).toBe(1);

    writeCsvPatch.mockResolvedValue(writeResult());
    const manifest = project.getManifest(MOD_ROOT);
    completeSavedWrite.mockImplementationOnce(async () => {
      expect(Object.keys(state.documents.ships.dirty).length).toBe(0);
      expect(csvRows(state, true)[0]?.data.hullName).toBe('B');
    });

    expect(await saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] })).toMatchObject({ status: 'saved' });
    expect(writeCsvPatch).toHaveBeenCalledWith(
      'sess-1',
      MOD_ROOT,
      'ships',
      [{ rowKey: 'ships:r1', action: 'upsert', isComment: false, row: { id: 'npc1', hullName: 'B' } }],
      [],
      { preserveOriginalJson: false, confirmedSources: [] },
      [],
      null,
    );
    expect(completeSavedWrite).toHaveBeenCalledWith({
      modRoot: MOD_ROOT,
      sessionId: SESSION_ID,
      label: '保存 ships CSV',
      result: expect.objectContaining({ changes: expect.any(Array) }),
    });
    expect(Object.keys(state.documents.ships.dirty).length).toBe(0);
  });

  it('submits a delete patch for dirty deletion rows', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();

    replaceCsvTableDraft(state.documents.ships, [csvDraftRow({ id: 'npc1', hullName: 'A' }, 'ships:r1')]);
    state.documents.ships.dirty['ships:r1'] = { action: 'delete' };

    writeCsvPatch.mockResolvedValue(writeResult());
    completeSavedWrite.mockResolvedValue(undefined);
    const manifest = project.getManifest(MOD_ROOT);

    expect(await saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] })).toMatchObject({ status: 'saved' });
    expect(writeCsvPatch).toHaveBeenCalledWith(
      'sess-1',
      MOD_ROOT,
      'ships',
      [{ rowKey: 'ships:r1', action: 'delete', isComment: false, row: {} }],
      [],
      {
        preserveOriginalJson: false,
        confirmedSources: [],
      },
      [],
      null,
    );
  });

  it('is a noop when the session changed since capture', async () => {
    const tables = useCsvEditorStore();
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();

    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'B');
    const manifest = project.getManifest(MOD_ROOT);
    project.manifests.set(MOD_ROOT, { ...buildManifest(), sessionId: 'sess-2' });

    expect(await saveCsvChanges({ table: 'ships', manifest, selectAssociatedSpecs: async () => [] })).toMatchObject({ status: 'noop' });
    expect(writeCsvPatch).not.toHaveBeenCalled();
    expect(state.documents.ships.dirty['ships:r1']).toBeDefined();
  });

  it('keeps edits made during writing dirty against the persisted snapshot', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();
    markCsvTableSavedDraft(state.documents.ships);
    const tables = useCsvEditorStore();
    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'B');
    let resolveWrite!: (result: WriteResult) => void;
    writeCsvPatch.mockImplementationOnce(() => new Promise<WriteResult>((resolve) => (resolveWrite = resolve)));
    const pending = saveCsvChanges({ table: 'ships', manifest: project.getManifest(MOD_ROOT), selectAssociatedSpecs: async () => [] });
    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'C');
    resolveWrite(writeResult());
    await pending;
    expect(csvRows(state, true)[0]?.data.hullName).toBe('B');
    expect(csvRows(state)[0]?.data.hullName).toBe('C');
    expect(state.documents.ships.dirty['ships:r1']).toEqual({ action: 'upsert', cells: { hullName: 'C' } });
    expect(await tables.activeEditor!.undo()).toBeTruthy();
    expect(csvRows(state)[0]?.data.hullName).toBe('B');
    expect(state.documents.ships.dirty['ships:r1']).toBeUndefined();
    expect(useCsvEditorStore().activeEditor!.canUndo.value).toBe(false);
  });

  it('keeps a return to the old baseline dirty when the submitted version was written', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();
    markCsvTableSavedDraft(state.documents.ships);
    const tables = useCsvEditorStore();
    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'B');
    completeSavedWrite.mockImplementationOnce(async () =>
      tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'A'),
    );
    writeCsvPatch.mockResolvedValueOnce(writeResult());
    await saveCsvChanges({ table: 'ships', manifest: project.getManifest(MOD_ROOT), selectAssociatedSpecs: async () => [] });
    expect(csvRows(state, true)[0]?.data.hullName).toBe('B');
    expect(state.documents.ships.dirty['ships:r1']).toEqual({ action: 'upsert', cells: { hullName: 'A' } });
  });

  it('maps a newly saved row and keeps its later deletion replayable', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();
    state.documents.ships.header = ['id', 'hullName'];
    const tables = useCsvEditorStore();
    const created = tables.addNewRow()!;
    let resolveWrite!: (result: WriteResult) => void;
    writeCsvPatch.mockImplementationOnce(() => new Promise<WriteResult>((resolve) => (resolveWrite = resolve)));
    const pending = saveCsvChanges({ table: 'ships', manifest: project.getManifest(MOD_ROOT), selectAssociatedSpecs: async () => [] });
    tables.deleteSelected();
    resolveWrite(
      writeResult({
        identityChanges: [],
        keyMap: [
          {
            rowIndex: 0,
            previousKey: created.rowKey,
            nextKey: 'ships:row:2',
          },
        ],
      }),
    );
    await pending;
    expect(state.documents.ships.dirty['ships:row:2']).toEqual({ action: 'delete' });
    expect(useCsvEditorStore().activeEditor!.canUndo.value).toBe(true);
    await tables.activeEditor!.undo();
    expect(csvRows(state).some((row) => row?.rowKey === 'ships:row:2')).toBe(true);
    expect(state.documents.ships.dirty['ships:row:2']).toBeUndefined();
  });

  it('accepts the persisted baseline when the backend reports an unchanged file', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();
    const tables = useCsvEditorStore();
    tables.updateCellValue({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships', rowKey: 'ships:r1', column: 'hullName' }, 'B');
    writeCsvPatch.mockResolvedValueOnce(writeResult({ changes: [] }));
    await saveCsvChanges({ table: 'ships', manifest: project.getManifest(MOD_ROOT), selectAssociatedSpecs: async () => [] });
    expect(state.documents.ships.dirty['ships:r1']).toBeUndefined();
    expect(csvRows(state, true)[0]?.data.hullName).toBe('B');
    expect(useCsvEditorStore().activeEditor!.canUndo.value).toBe(false);
  });

  it('rebases a deletion undone during saving into an insert at the original position', async () => {
    const project = useProjectStore();
    project.manifests.set(MOD_ROOT, buildManifest());
    const state = hydrateActiveTable();
    replaceCsvTableDraft(state.documents.ships, [csvDraftRow({ id: 'first' }, 'ships:r1'), csvDraftRow({ id: 'second' }, 'ships:r2')]);
    markCsvTableSavedDraft(state.documents.ships);
    const tables = useCsvEditorStore();
    tables.selectRowByKey({ sessionId: SESSION_ID, modRoot: MOD_ROOT, table: 'ships' }, 'ships:r1');
    tables.deleteSelected();
    let release!: (result: WriteResult) => void;
    writeCsvPatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const saving = saveCsvChanges({ table: 'ships', manifest: project.getManifest(MOD_ROOT), selectAssociatedSpecs: async () => [] });
    await tables.activeEditor!.undo();
    release(writeResult());
    await saving;
    const restoredKey = csvRows(state)[0]!.rowKey;
    expect(restoredKey).toMatch(/^ships:new:/);
    expect(state.documents.ships.rowOrder[0]).toBe(restoredKey);
    expect(state.documents.ships.dirty[restoredKey]?.action).toBe('upsert');
    writeCsvPatch.mockResolvedValueOnce(writeResult({ keyMap: [{ previousKey: restoredKey, nextKey: 'ships:row:3', rowIndex: 0 }] }));
    await saveCsvChanges({ table: 'ships', manifest: project.getManifest(MOD_ROOT), selectAssociatedSpecs: async () => [] });
    expect(writeCsvPatch.mock.calls.at(-1)?.[3]).toEqual([
      { rowKey: restoredKey, action: 'upsert', isComment: false, row: { id: 'first' } },
    ]);
    expect(csvRows(state).map((row) => row?.data.id)).toEqual(['first', 'second']);
    expect(state.documents.ships.baselineRowOrder).toEqual(state.documents.ships.rowOrder);
    expect(state.documents.ships.dirty).toEqual({});
  });
});
