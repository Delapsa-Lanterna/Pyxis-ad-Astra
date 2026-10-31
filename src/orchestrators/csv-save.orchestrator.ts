import type {
  AppFeedback,
  AssociatedSpecChange,
  CsvRowPatch,
  CsvModState,
  ProjectManifest,
  CsvTableKey,
  WindowIdentity,
} from '@/shared/types';
import { getAssociatedSpecCandidates } from '@/domain/csv-editor/associated-spec-candidates';
import { isCsvDeletedRow } from '@/domain/csv-editor/csv-dirty';
import { saveCsvPatch, captureAssociatedSpecTarget } from '@/services/csv-table.service';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useProjectStore } from '@/stores/project.store';
import type { AssociatedSpecCandidate } from '@/domain/csv-editor/associated-spec-candidates';
import { beginSavedWrite } from '@/orchestrators/project-sync.orchestrator';

import { recordLogBestEffort } from '@/services/app-log.service';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { commitCsvTableSaveDraft, hasCsvTableDraftChanges, hasCsvRowOrderChanges } from '@/domain/csv-editor/csv-table-draft';
import { deepClone } from '@/shared/lib/starsector';
import { retainLaterDraft } from '@/domain/edit-session';
import { isAbsoluteFsPath, joinRootRelativePath, normalizeFsPath } from '@/shared/lib/paths';

import { reserveNativeWindowTargets, releaseNativeWindowTargets } from '@/services/window.service';

import { focusEntityIdentityConflict } from '@/orchestrators/window-target-focus.orchestrator';

export type CsvSaveResult = import('@/shared/runtime/document-editor').DocumentSaveResult;

interface CapturedTableSaveTarget {
  manifest: ProjectManifest;
  modRoot: string;
  state: CsvModState;
  table: CsvTableKey;
}

interface TableSaveOptions {
  table: CsvTableKey;
  manifest: ProjectManifest | null;
  selectAssociatedSpecs: (candidates: AssociatedSpecCandidate[]) => Promise<AssociatedSpecChange[] | null>;
  feedback?: AppFeedback;
}

export async function saveCsvChanges(options: TableSaveOptions): Promise<CsvSaveResult> {
  const tables = useCsvEditorStore();
  const target = captureTableSaveTarget(options);
  if (!target) return { status: 'noop' };
  const identity = { sessionId: target.manifest.sessionId, modRoot: target.modRoot, table: target.table };
  tables.revokeTableReads(target.modRoot, target.table);
  tables.setSaving(identity, true);
  try {
    return await saveTarget(target, options);
  } finally {
    await releaseNativeWindowTargets();
    tables.setSaving(identity, false);
  }
}

function captureTableSaveTarget({ manifest, table }: TableSaveOptions): CapturedTableSaveTarget | null {
  const tables = useCsvEditorStore();
  if (!manifest) return null;
  const modRoot = manifest.modRoot;
  const state = tables.getCsvModState(modRoot);
  if (!state) return null;
  return { manifest, modRoot, state, table };
}

async function saveTarget(target: CapturedTableSaveTarget, options: TableSaveOptions): Promise<CsvSaveResult> {
  const tables = useCsvEditorStore();
  const state = target.state;
  const { manifest, modRoot, table } = target;
  const capture = () => ({
    changed: hasCsvTableDraftChanges(state.documents[table]) || !manifest.tableSummaries[table].available,
    submittedHistory: tables.captureSaveHistory(modRoot, table),
    patches: buildCurrentTablePatches(state, table),
    originalRows: deepClone(state.documents[table].baselineRows),
    rowOrder: hasCsvRowOrderChanges(state.documents[table]) ? [...state.documents[table].rowOrder] : null,
    baseVersions: deepClone(state.documents[table].baseVersions),
    candidates: deepClone(getAssociatedSpecCandidates(state.documents[table], manifest.associatedSpecTables)),
  });
  let captured = capture();
  const pending = tables.getTableInputs(modRoot, table).commit(undefined, true, () => {
    captured = capture();
  });
  if (pending && !(await pending)) return { status: 'cancelled' };
  if (!isTableSaveTargetCurrent(target)) return { status: 'noop' };
  if (!captured.changed) return { status: 'noop' };
  const { submittedHistory, patches, originalRows, rowOrder, baseVersions, candidates } = captured;
  const sourceTargets = new Map(
    candidates.length > 0
      ? await Promise.all(
          candidates.map(
            async (candidate) =>
              [
                candidate.key,
                await captureAssociatedSpecTarget(manifest.sessionId, table, candidate.change).catch(async (error) => {
                  await focusEntityIdentityConflict(manifest.sessionId, modRoot, error);
                  throw error;
                }),
              ] as const,
          ),
        )
      : [],
  );
  const associatedSpecs = candidates.length > 0 ? await options.selectAssociatedSpecs(candidates) : [];
  if (associatedSpecs === null) return { status: 'cancelled' };
  if (!isTableSaveTargetCurrent(target)) return { status: 'noop' };
  const writes = associatedSpecs.map((change) => {
    const candidate = candidates.find(
      (candidate) =>
        candidate.change.action === change.action &&
        (change.action === 'delete'
          ? candidate.change.action === 'delete' && candidate.change.id === change.id
          : candidate.change.action !== 'delete' && candidate.change.create.id === change.create.id),
    )!;
    const source = sourceTargets.get(candidate.key)!;
    for (const version of source.versions) if (!baseVersions.some((existing) => existing.path === version.path)) baseVersions.push(version);
    return { change, target: source.target };
  });
  const reservations = writes.flatMap<WindowIdentity>((write) => {
    if (write.change.action === 'delete') return [];
    const nextId = write.change.create.id;
    const candidate = candidates.find((candidate) => candidate.change.action !== 'delete' && candidate.change.create.id === nextId)!;
    const next = sourceTargets.get(candidate.key)!.nextWrite;
    const identities: WindowIdentity[] = [{ type: 'file', sessionId: manifest.sessionId, modRoot, path: next.path }];
    if (write.target.kind === 'ship' || write.target.kind === 'weapon' || write.target.kind === 'system')
      identities.push({ type: 'spec', sessionId: manifest.sessionId, modRoot, kind: write.target.kind, id: write.change.create.id });
    return identities;
  });
  if (reservations.length > 0) await reserveNativeWindowTargets(reservations);
  const operation = beginSavedWrite(
    (request) =>
      runConfirmedJsonWrite(options.feedback, (writeOptions) =>
        saveCsvPatch(manifest.sessionId, modRoot, table, patches, writes, writeOptions, baseVersions, rowOrder, originalRows, request),
      ),
    (result) => [
      () => {
        if (!isTableSaveTargetCurrent(target)) return;
        tables.revokeTableReads(modRoot, table);
        const keyMap = deepClone(result.keyMap);
        const savedRows =
          result.content?.target.kind === 'csv' ? (result.content.value as unknown as import('@/shared/types').CsvTableRowsRead).rows : [];
        const actualPatches = patches.map((patch) => {
          const key = keyMap.find((mapping) => mapping.previousKey === patch.rowKey)?.nextKey ?? patch.rowKey;
          const saved = savedRows.find((row) => row.rowKey === key);
          if (!saved) return patch;
          const current = state.documents[table].rows[patch.rowKey];
          if (current) {
            current.data = retainLaterDraft(current.data, patch.row, saved.data);
            current.isComment = retainLaterDraft(current.isComment, patch.isComment, saved.isComment);
          }
          return { ...patch, row: saved.data, isComment: saved.isComment };
        });
        commitCsvTableSaveDraft(state.documents[table], actualPatches, keyMap, rowOrder);
        const tablePath = normalizeFsPath(joinRootRelativePath(modRoot, manifest.tableSummaries[table].path));
        state.documents[table].baseVersions = result.baseVersions.filter(
          (version) =>
            normalizeFsPath(isAbsoluteFsPath(version.path) ? version.path : joinRootRelativePath(modRoot, version.path)) === tablePath,
        );
        tables.applySavedRowKeyMap(modRoot, table, keyMap);
        tables.commitSaveHistory(modRoot, table, submittedHistory);
      },
      () => releaseNativeWindowTargets(),
    ],
  );
  const result = await operation.result;
  if (!result) return { status: 'cancelled' };
  recordLogBestEffort({
    level: 'info',
    code: 'tables.csv_saved',
    message: 'csv saved',
    path: null,
    line: null,
    fields: {
      modRoot,
      sessionId: manifest.sessionId,
      table,
      patches: String(patches.length),
      changes: String(result.changes.length),
      associatedSpecs: String(associatedSpecs.length),
    },
  });
  return { status: 'saved', receipt: result };
}

function isTableSaveTargetCurrent(target: CapturedTableSaveTarget): boolean {
  const tables = useCsvEditorStore();
  const project = useProjectStore();
  const currentManifest = project.getManifest(target.modRoot);
  return currentManifest?.sessionId === target.manifest.sessionId && tables.getCsvModState(target.modRoot) === target.state;
}

function buildCurrentTablePatches(state: CsvModState, table: CsvTableKey): CsvRowPatch[] {
  const dirty = state.documents[table].dirty ?? {};
  const deletedKeys = new Set(Object.keys(dirty).filter((key) => isCsvDeletedRow(dirty[key])));
  const patches: CsvRowPatch[] = [...deletedKeys].map((rowKey) => ({ rowKey, action: 'delete', row: {}, isComment: false }));
  for (const [rowKey, change] of Object.entries(dirty)) {
    if (change.action === 'delete') continue;
    const row = state.documents[table].rows[rowKey]!;
    patches.push({ rowKey, action: 'upsert', row: deepClone(row.data), isComment: row.isComment });
  }
  return patches;
}
