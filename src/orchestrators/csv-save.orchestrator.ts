import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useProjectStore } from '@/stores/project.store';
import { useSettingsStore } from '@/stores/settings.store';
import { saveCsvPatch, prepareCsvAssociatedSpecs, queryTableIndex, queryCsvValidation } from '@/services/csv-table.service';
import { reserveNativeWindowTargets, releaseNativeWindowTargets } from '@/services/window.service';
import { getAssociatedSpecCandidates, type AssociatedSpecCandidate } from '@/domain/csv-editor/associated-spec-candidates';
import { hasCsvTableDraftChanges, hasCsvRowOrderChanges, commitCsvTableSaveDraft } from '@/domain/csv-editor/csv-table-draft';
import { csvTableIssues, csvValidationRows } from '@/domain/csv-editor/csv-validation';
import { csvValidationRequest } from '@/domain/csv-editor/csv-rule-context';
import { retainLaterDraft } from '@/domain/edit-session';
import { beginSavedWrite } from './project-sync.orchestrator';
import { AppError } from '@/shared/lib/errors';
import { deepClone, MODULE_LABELS } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { normalizeFsPath, joinRootRelativePath, isAbsoluteFsPath } from '@/shared/lib/paths';
import { infoLog } from '@/shared/runtime/app-log-queue';
import { dialogBody, dialogFiles } from '@/shared/ui/dialog-content';
import type {
  AppFeedback,
  AssociatedSpecWrite,
  CsvRowPatch,
  CsvTableKey,
  CsvTableState,
  ProjectManifest,
  WindowIdentity,
} from '@/shared/types';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';

export type CsvSaveResult = DocumentSaveResult;
interface TableSaveOptions {
  table: CsvTableKey;
  manifest: ProjectManifest | null;
  selectAssociatedSpecs: (candidates: AssociatedSpecCandidate[]) => Promise<AssociatedSpecWrite[] | null>;
  feedback?: AppFeedback;
}

function patchesFor(document: CsvTableState): CsvRowPatch[] {
  return Object.entries(document.dirty)
    .sort(([, left], [, right]) => Number(right.action === 'delete') - Number(left.action === 'delete'))
    .map(([rowKey, edit]) => {
      if (edit.action === 'delete') return { rowKey, action: 'delete', row: {}, isComment: false, columns: [], commentChanged: false };
      const row = document.rows[rowKey]!,
        original = document.baselineRows[rowKey];
      return {
        rowKey,
        action: 'upsert',
        row: deepClone(row.data),
        isComment: row.isComment,
        columns: Object.keys(row.data).filter((column) => !original || !stableDeepEqual(row.data[column], original.data[column])),
        commentChanged: !original || row.isComment !== original.isComment,
      };
    });
}

export async function saveCsvChanges(options: TableSaveOptions): Promise<CsvSaveResult> {
  const manifest = options.manifest,
    tables = useCsvEditorStore();
  if (!manifest) return { status: 'noop' };
  const { table } = options,
    { modRoot, sessionId } = manifest,
    state = tables.getCsvModState(modRoot);
  if (!state) return { status: 'noop' };
  const identity = { sessionId, modRoot, table },
    document = state.documents[table];
  const current = () => useProjectStore().getManifest(modRoot)?.sessionId === sessionId && tables.getCsvModState(modRoot) === state;
  const problems = tables.getTableProblems(identity);
  tables.revokeTableReads(modRoot, table);
  tables.setSaving(identity, true);
  problems.clearFailure();
  try {
    const committed = tables.getTableInputs(modRoot, table).commit(undefined, true);
    if (committed && !(await committed)) return { status: 'cancelled' };
    if (!current()) return { status: 'noop' };
    if (!hasCsvTableDraftChanges(document) && manifest.tableSummaries[table].available) return { status: 'noop' };
    if (document.validationRows === null) {
      const index = await queryTableIndex(sessionId, table, 0, null, 'id-name');
      if (!current()) return { status: 'noop' };
      tables.applyTableIndex(identity, index);
    }
    if (document.externalUpdatePending) throw new AppError('CSV 文件已更新，请先处理外部版本', { code: 'csv.external_update' });
    const refuse = () => {
      throw new AppError(`${MODULE_LABELS[table]}存在校验错误`, { action: 'csv-validation' });
    };
    if (csvTableIssues({ ...document, validationContext: null }).some((issue) => issue.severity === 'error')) refuse();
    const validation = csvValidationRequest(table, csvValidationRows(document)),
      key = JSON.stringify(validation);
    const context = await queryCsvValidation(sessionId, validation);
    if (!current()) return { status: 'noop' };
    if (JSON.stringify(csvValidationRequest(table, csvValidationRows(document))) !== key) return await saveCsvChanges(options);
    tables.acceptTableValidation(identity, key, context);
    const issues = [...problems.issues.value];
    if (issues.some((issue) => issue.severity === 'error')) refuse();
    const patches = patchesFor(document),
      rowOrder = hasCsvRowOrderChanges(document) ? [...document.rowOrder] : null;
    const versions = deepClone(document.baseVersions),
      originals = deepClone(document.baselineRows);
    const history = tables.captureSaveHistory(modRoot, table);
    const captured = deepClone([patches, rowOrder, versions, issues]);
    const unchanged = () =>
      !tables.getTableInputs(modRoot, table).dirty.value &&
      stableDeepEqual(captured, [
        patchesFor(document),
        hasCsvRowOrderChanges(document) ? document.rowOrder : null,
        document.baseVersions,
        problems.issues.value,
      ]);
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
      if (!current()) return { status: 'noop' };
      if (!unchanged()) return await saveCsvChanges(options);
    }
    const candidates = deepClone(getAssociatedSpecCandidates(document, manifest.associatedSpecTables));
    if (candidates.length) {
      const prepared = await prepareCsvAssociatedSpecs(
        sessionId,
        table,
        candidates.map((candidate) => candidate.change),
      );
      if (!current()) return { status: 'noop' };
      candidates.forEach((candidate, index) => {
        candidate.preparation = prepared[index]!;
        candidate.mode = prepared[index]!.destination.version.fingerprint && !prepared[index]!.destination.problem ? 'read' : 'overwrite';
      });
    }
    const associated = candidates.length ? await options.selectAssociatedSpecs(candidates) : [];
    if (!associated) return { status: 'cancelled' };
    if (!current()) return { status: 'noop' };
    if (!unchanged()) return await saveCsvChanges(options);
    if (['ships', 'skills'].includes(table) && context.complete) {
      const kind = table === 'ships' ? 'ship' : 'skill';
      for (const patch of patches)
        if (patch.action === 'upsert' && !patch.isComment) {
          const id = String(patch.row.id ?? '');
          if (
            id &&
            !context.entities[`${kind}:${id}`] &&
            !associated.some((write) => write.change.action !== 'delete' && write.change.create.id === id)
          )
            throw new AppError(`${MODULE_LABELS[table]}规格 ${JSON.stringify(id)} 尚未准备，请选择关联规格后保存`, {
              code: 'csv.spec_missing',
            });
        }
    }
    for (const write of associated) {
      const prepared = candidates.find(
        (candidate) => candidate.change.action === write.change.action && candidate.preparation!.target.id === write.target.id,
      )!.preparation!;
      for (const version of prepared.baseVersions) if (!versions.some((existing) => existing.path === version.path)) versions.push(version);
    }
    const reservations = associated.flatMap<WindowIdentity>((write) => {
      if (write.change.action === 'delete') return [];
      const destinations: WindowIdentity[] = [
        { type: 'text-editor', sessionId, modRoot, path: write.resolution!.destination.location.path },
      ];
      if (write.change.action === 'rename' && write.resolution!.original?.location.source === 'mod')
        destinations.push({ type: 'text-editor', sessionId, modRoot, path: write.resolution!.original.location.path });
      if (write.target.kind === 'ship' || write.target.kind === 'weapon' || write.target.kind === 'system') {
        destinations.push({ type: 'spec', sessionId, modRoot, kind: write.target.kind, id: write.change.create.id });
        if (write.change.action === 'rename')
          destinations.push({ type: 'spec', sessionId, modRoot, kind: write.target.kind, id: write.change.previousId });
      }
      return destinations;
    });
    if (reservations.length) await reserveNativeWindowTargets(reservations);
    if (!current()) return { status: 'noop' };
    if (!unchanged()) return await saveCsvChanges(options);
    const operation = beginSavedWrite(
      (request) =>
        saveCsvPatch(
          sessionId,
          modRoot,
          table,
          patches,
          associated,
          { preserveStructure: useSettingsStore().preserveStructure },
          versions,
          rowOrder,
          originals,
          request,
        ),
      (result) => [
        () => {
          if (!current()) return;
          tables.revokeTableReads(modRoot, table);
          const keyMap = deepClone(result.keyMap);
          const actual = result.content!.value;
          const saved = new Map(actual.rows.map((row) => [row.rowKey, row]));
          const accepted = patches.map((patch) => {
            const key = keyMap.find((mapping) => mapping.previousKey === patch.rowKey)?.nextKey ?? patch.rowKey,
              row = saved.get(key);
            if (!row) return patch;
            const currentRow = document.rows[patch.rowKey];
            if (currentRow) {
              currentRow.data = retainLaterDraft(currentRow.data, patch.row, row.data);
              currentRow.isComment = retainLaterDraft(currentRow.isComment, patch.isComment, row.isComment);
            }
            return { ...patch, row: row.data, isComment: row.isComment };
          });
          commitCsvTableSaveDraft(document, accepted, keyMap, rowOrder);
          const path = normalizeFsPath(joinRootRelativePath(modRoot, manifest.tableSummaries[table].path));
          document.baseVersions = result.baseVersions.filter(
            (version) =>
              normalizeFsPath(isAbsoluteFsPath(version.path) ? version.path : joinRootRelativePath(modRoot, version.path)) === path,
          );
          tables.applySavedRowKeyMap(modRoot, table, keyMap);
          tables.commitSaveHistory(modRoot, table, history);
        },
        () => releaseNativeWindowTargets(),
      ],
    );
    const result = await operation.result;
    infoLog('tables.history_submitted', () => ({
      modRoot,
      sessionId,
      table,
      requestId: result.requestId ?? operation.id,
      historyIds: JSON.stringify([...history.undoIds]),
    }));
    return { status: 'saved', receipt: result };
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
