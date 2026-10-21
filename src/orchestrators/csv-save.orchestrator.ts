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
import { completeSavedWrite, retryPendingModSyncs } from '@/orchestrators/project-sync.orchestrator';

import { recordLogBestEffort } from '@/services/app-log.service';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { commitCsvTableSaveDraft, hasCsvTableDraftChanges, hasCsvRowOrderChanges } from '@/domain/csv-editor/csv-table-draft';
import { deepClone } from '@/shared/lib/starsector';
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
  synchronize?: (receipt: import('@/shared/types').WriteResult) => Promise<void>;
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
  const synchronization = retryPendingModSyncs(target.modRoot);
  if (synchronization) await synchronization;
  const tables = useCsvEditorStore();
  const state = target.state;
  const pending = tables.getTableInputs(target.modRoot, target.table).commit();
  if (pending && !(await pending)) return { status: 'cancelled' };
  if (!isTableSaveTargetCurrent(target)) return { status: 'noop' };
  const { manifest, modRoot, table } = target;
  if (!hasCsvTableDraftChanges(state.documents[table]) && manifest.tableSummaries[table].available) return { status: 'noop' };

  const submittedHistory = tables.captureSaveHistory(modRoot, table);
  const patches = buildCurrentTablePatches(state, table);
  const rowOrder = hasCsvRowOrderChanges(state.documents[table]) ? [...state.documents[table].rowOrder] : null;
  const baseVersions = deepClone(state.documents[table].baseVersions);
  const candidates = deepClone(getAssociatedSpecCandidates(state.documents[table], manifest.associatedSpecTables));
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
  const result = await runConfirmedJsonWrite(options.feedback, (writeOptions) =>
    saveCsvPatch(manifest.sessionId, modRoot, table, patches, writes, writeOptions, baseVersions, rowOrder),
  );
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
  if (!isTableSaveTargetCurrent(target)) return { status: 'saved', receipt: result };
  tables.revokeTableReads(modRoot, table);
  const keyMap = deepClone(result.keyMap);
  commitCsvTableSaveDraft(state.documents[table], patches, keyMap, rowOrder);
  const tablePath = normalizeFsPath(joinRootRelativePath(modRoot, manifest.tableSummaries[table].path));
  state.documents[table].baseVersions = result.baseVersions.filter(
    (version) => normalizeFsPath(isAbsoluteFsPath(version.path) ? version.path : joinRootRelativePath(modRoot, version.path)) === tablePath,
  );
  tables.applySavedRowKeyMap(modRoot, table, keyMap);
  tables.commitSaveHistory(modRoot, table, submittedHistory);
  await releaseNativeWindowTargets();
  if (options.synchronize) await options.synchronize(result);
  else await completeSavedWrite({ modRoot, result, label: `保存 ${table} CSV`, sessionId: manifest.sessionId });
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
