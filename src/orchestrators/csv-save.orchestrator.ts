import { useSettingsStore } from '@/stores/settings.store';
import type {
  AppFeedback,
  CsvRowPatch,
  CsvModState,
  ProjectManifest,
  CsvTableKey,
  WindowIdentity,
  AssociatedSpecWrite,
  CsvTableRowsRead,
} from '@/shared/types';
import { getAssociatedSpecCandidates } from '@/domain/csv-editor/associated-spec-candidates';
import { isCsvDeletedRow } from '@/domain/csv-editor/csv-dirty';
import { saveCsvPatch, prepareCsvAssociatedSpecs, queryTableIndex, queryCsvValidation } from '@/services/csv-table.service';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useProjectStore } from '@/stores/project.store';
import type { AssociatedSpecCandidate } from '@/domain/csv-editor/associated-spec-candidates';
import { beginSavedWrite } from '@/orchestrators/project-sync.orchestrator';

import { infoLog } from '@/shared/runtime/app-log-queue';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { commitCsvTableSaveDraft, hasCsvTableDraftChanges, hasCsvRowOrderChanges } from '@/domain/csv-editor/csv-table-draft';
import { deepClone, MODULE_LABELS } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { AppError } from '@/shared/lib/errors';
import { dialogBody, dialogFiles } from '@/shared/ui/dialog-content';
import { retainLaterDraft } from '@/domain/edit-session';
import { csvTableIssues, csvValidationRows } from '@/domain/csv-editor/csv-validation';
import { csvValidationRequest } from '@/domain/csv-editor/csv-rule-context';
import { isAbsoluteFsPath, joinRootRelativePath, normalizeFsPath } from '@/shared/lib/paths';

import { reserveNativeWindowTargets, releaseNativeWindowTargets } from '@/services/window.service';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';

export type CsvSaveResult = DocumentSaveResult;

interface CapturedTableSaveTarget {
  manifest: ProjectManifest;
  modRoot: string;
  state: CsvModState;
  table: CsvTableKey;
}

interface TableSaveOptions {
  table: CsvTableKey;
  manifest: ProjectManifest | null;
  selectAssociatedSpecs: (candidates: AssociatedSpecCandidate[]) => Promise<AssociatedSpecWrite[] | null>;
  feedback?: AppFeedback;
}

export async function saveCsvChanges(options: TableSaveOptions): Promise<CsvSaveResult> {
  const tables = useCsvEditorStore();
  const target = captureTableSaveTarget(options);
  if (!target) return { status: 'noop' };
  const identity = { sessionId: target.manifest.sessionId, modRoot: target.modRoot, table: target.table };
  const problems = tables.getTableProblems(identity);
  problems.clearFailure();
  tables.revokeTableReads(target.modRoot, target.table);
  tables.setSaving(identity, true);
  try {
    const result = await saveTarget(target, options);
    if (result.status === 'saved') problems.clearFailure();
    return result;
  } catch (error) {
    if (!(error instanceof AppError && ['csv-validation', 'commit-field-inputs'].includes(error.action ?? '')))
      problems.recordFailure(error);
    problems.reveal();
    throw error;
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
  const pending = tables.getTableInputs(modRoot, table).commit(undefined, true);
  if (pending && !(await pending)) return { status: 'cancelled' };
  if (!isTableSaveTargetCurrent(target)) return { status: 'noop' };
  let captured = capture();
  if (!captured.changed) return { status: 'noop' };
  const identity = { sessionId: manifest.sessionId, modRoot, table };
  if (state.documents[table].validationRows === null) {
    const index = await queryTableIndex(manifest.sessionId, table, 0, null, 'id-name');
    if (!isTableSaveTargetCurrent(target)) return { status: 'noop' };
    tables.applyTableIndex(identity, index);
  }
  if (state.documents[table].externalUpdatePending) throw new AppError('CSV 文件已更新，请先处理外部版本', { code: 'csv.external_update' });
  const problems = tables.getTableProblems(identity);
  const refuse = () => {
    throw new AppError(`${MODULE_LABELS[table]}存在校验错误`, {
      action: 'csv-validation',
      userMessage: `${MODULE_LABELS[table]}：请先解决详情栏顶部错误后再保存`,
    });
  };
  if (csvTableIssues({ ...state.documents[table], validationContext: null }).some((issue) => issue.severity === 'error')) refuse();
  const request = csvValidationRequest(table, csvValidationRows(state.documents[table]));
  const key = JSON.stringify(request);
  const context = await queryCsvValidation(manifest.sessionId, request);
  if (!isTableSaveTargetCurrent(target)) return { status: 'noop' };
  if (key !== JSON.stringify(csvValidationRequest(table, csvValidationRows(state.documents[table])))) return saveTarget(target, options);
  tables.acceptTableValidation(identity, key, context);
  captured = capture();
  const issues = [...problems.issues.value];
  if (issues.some((issue) => issue.severity === 'error'))
    throw new AppError(`${MODULE_LABELS[table]}存在校验错误`, {
      action: 'csv-validation',
      userMessage: `${MODULE_LABELS[table]}：请先解决详情栏顶部错误后再保存`,
    });
  const confirmed = deepClone([captured.patches, captured.rowOrder, captured.baseVersions, issues]);
  const unchanged = () => {
    const document = state.documents[table];
    return (
      !tables.getTableInputs(modRoot, table).dirty.value &&
      stableDeepEqual(confirmed, [
        buildCurrentTablePatches(state, table),
        hasCsvRowOrderChanges(document) ? document.rowOrder : null,
        document.baseVersions,
        problems.issues.value,
      ])
    );
  };
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  if (warnings.length && !useSettingsStore().ignoreEditorWarnings) {
    const choice = await options.feedback!.choose({
      title: '仍要保存吗？',
      content: () =>
        dialogBody(
          `${MODULE_LABELS[table]}有 ${warnings.length} 条保存提醒：`,
          dialogFiles([manifest.tableSummaries[table].path]),
          ...warnings.map((issue) => issue.message),
        ),
      choices: [{ label: '仍然保存', value: 'save', type: 'warning' }],
      cancelText: '返回编辑',
    });
    if (choice !== 'save') return { status: 'cancelled' };
    if (!isTableSaveTargetCurrent(target)) return { status: 'noop' };
    if (!unchanged()) return saveTarget(target, options);
  }
  const { submittedHistory, patches, originalRows, rowOrder, baseVersions, candidates } = captured;
  if (candidates.length) {
    const prepared = await prepareCsvAssociatedSpecs(
      manifest.sessionId,
      table,
      candidates.map((candidate) => candidate.change),
    );
    if (!isTableSaveTargetCurrent(target)) return { status: 'noop' };
    candidates.forEach((candidate, index) => {
      candidate.preparation = prepared[index]!;
      candidate.mode = prepared[index]!.destination.version.fingerprint && !prepared[index]!.destination.problem ? 'read' : 'overwrite';
    });
  }
  const associatedSpecs = candidates.length > 0 ? await options.selectAssociatedSpecs(candidates) : [];
  if (associatedSpecs === null) return { status: 'cancelled' };
  if (!isTableSaveTargetCurrent(target)) return { status: 'noop' };
  if (candidates.length && !unchanged()) return saveTarget(target, options);
  const writes = associatedSpecs;
  if (['ships', 'skills'].includes(table) && context.complete) {
    const kind = table === 'ships' ? 'ship' : 'skill';
    for (const patch of patches) {
      if (patch.action !== 'upsert' || patch.isComment) continue;
      const id = String(patch.row.id ?? '');
      if (
        id &&
        !context.entities[`${kind}:${id}`] &&
        !writes.some((write) => write.change.action !== 'delete' && write.change.create.id === id)
      )
        throw new AppError(`${MODULE_LABELS[table]}规格 ${JSON.stringify(id)} 尚未准备，请选择关联规格后保存`, {
          code: 'csv.spec_missing',
        });
    }
  }
  for (const write of writes) {
    const candidate = candidates.find(
      (candidate) => candidate.change.action === write.change.action && candidate.preparation!.target.id === write.target.id,
    )!;
    for (const version of candidate.preparation!.baseVersions)
      if (!baseVersions.some((existing) => existing.path === version.path)) baseVersions.push(version);
  }
  const reservations = writes.flatMap<WindowIdentity>((write) => {
    if (write.change.action === 'delete') return [];
    const next = write.resolution!.destination.location;
    const identitiesToRemove =
      write.change.action === 'rename' && write.resolution!.original?.location.source === 'mod'
        ? [{ type: 'file' as const, sessionId: manifest.sessionId, modRoot, path: write.resolution!.original.location.path }]
        : [];
    const identities: WindowIdentity[] = [{ type: 'file', sessionId: manifest.sessionId, modRoot, path: next.path }];
    if (write.target.kind === 'ship' || write.target.kind === 'weapon' || write.target.kind === 'system')
      identities.push({ type: 'spec', sessionId: manifest.sessionId, modRoot, kind: write.target.kind, id: write.change.create.id });
    if (
      write.change.action === 'rename' &&
      (write.target.kind === 'ship' || write.target.kind === 'weapon' || write.target.kind === 'system')
    )
      identities.push({ type: 'spec', sessionId: manifest.sessionId, modRoot, kind: write.target.kind, id: write.change.previousId });
    return [...identities, ...identitiesToRemove];
  });
  if (reservations.length > 0) await reserveNativeWindowTargets(reservations);
  if (!isTableSaveTargetCurrent(target)) return { status: 'noop' };
  if (reservations.length && !unchanged()) return saveTarget(target, options);
  const operation = beginSavedWrite(
    (request) =>
      runConfirmedJsonWrite(
        options.feedback,
        (writeOptions) =>
          saveCsvPatch(manifest.sessionId, modRoot, table, patches, writes, writeOptions, baseVersions, rowOrder, originalRows, request),
        [],
        request.id,
      ),
    (result) => [
      () => {
        if (!isTableSaveTargetCurrent(target)) return;
        tables.revokeTableReads(modRoot, table);
        const keyMap = deepClone(result.keyMap);
        const savedRows = result.content?.target.kind === 'csv' ? (result.content.value as unknown as CsvTableRowsRead).rows : [];
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
  infoLog('tables.history_submitted', () => ({
    modRoot,
    sessionId: manifest.sessionId,
    table,
    requestId: result.requestId ?? operation.id,
    historyIds: JSON.stringify([...submittedHistory.undoIds]),
  }));
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
