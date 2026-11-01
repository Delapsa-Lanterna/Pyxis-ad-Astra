import type {
  CsvTableIndex,
  CsvTableRowsRead,
  CsvRowPreview,
  CsvTableIndexPayload,
  CsvTableRowsPayload,
  CsvRowPreviewPayload,
  CsvSave,
  AssociatedSpecChange,
  AssociatedSpecWrite,
  CsvSearchField,
  CsvRowPatch,
  JsonWriteOptions,
  CsvTableKey,
  WriteResult,
  DeepReadonly,
  FileVersion,
  CsvRowOrderEntry,
  CsvDraftRow,
  AssociatedSpecPreparation,
} from '@/shared/types';

import { invokeCommand, invokeSaveCommand, type SaveCommandRequest } from '@/shared/runtime/command.runtime';
import { CachedSessionQuery, readLiveSessionQuery, type SessionQueryDefinition } from '@/services/query-cache.service';
import type { ProjectInvalidation } from '@/shared/types';
import { queryResourceDataUrls } from '@/services/resource-media.service';

import { captureSaveEdits } from '@/domain/project/save-edits';

const readTableIndex = new CachedSessionQuery<Omit<CsvTableIndexPayload, 'sessionId'>, CsvTableIndex>({
  queryKind: 'csv-table-window',
  load: ({ sessionId, parameters }) =>
    invokeCommand<CsvTableIndex>('query_csv_table_index', { payload: { sessionId, ...parameters } satisfies CsvTableIndexPayload }),
  invalidates: (parameters, invalidation) =>
    invalidation.queryScopes.some((scope) => scope.kind === 'csv-table-window' && (!scope.table || scope.table === parameters.table)),
});

const readTableRows = {
  queryKind: 'csv-table-rows',
  load: ({ sessionId, parameters }) =>
    invokeCommand<CsvTableRowsRead>('query_csv_table_rows', { payload: { sessionId, ...parameters } satisfies CsvTableRowsPayload }),
  invalidates: (parameters, invalidation) =>
    invalidation.queryScopes.some((scope) => scope.kind === 'csv-table-window' && (!scope.table || scope.table === parameters.table)),
} satisfies SessionQueryDefinition<Omit<CsvTableRowsPayload, 'sessionId'>, CsvTableRowsRead>;

const readRowPreview = new CachedSessionQuery<Omit<CsvRowPreviewPayload, 'sessionId'>, CsvRowPreview>({
  queryKind: 'csv-row-preview',
  load: ({ sessionId, parameters }) =>
    invokeCommand<CsvRowPreview>('query_csv_row_preview', { payload: { sessionId, ...parameters } satisfies CsvRowPreviewPayload }),
  invalidates: (parameters, invalidation) =>
    invalidation.queryScopes.some((scope) => scope.kind === 'csv-row-preview' && (!scope.table || scope.table === parameters.table)),
});

export function saveCsvPatch(
  sessionId: string,
  modRoot: string,
  table: CsvTableKey,
  patches: CsvRowPatch[],
  associatedSpecs: AssociatedSpecWrite[],
  jsonWrite?: JsonWriteOptions,
  baseVersions: FileVersion[] = [],
  rowOrder: CsvRowOrderEntry[] | null = null,
  originalRows: Record<string, CsvDraftRow> = {},
  request?: SaveCommandRequest,
): Promise<WriteResult> {
  const before = Object.fromEntries(
    patches
      .filter((patch) => originalRows[patch.rowKey])
      .map((patch) => {
        const row = originalRows[patch.rowKey]!;
        return [patch.rowKey, { rowKey: row.rowKey, data: row.data, isComment: row.isComment }];
      }),
  );
  const after = Object.fromEntries(
    patches
      .filter((patch) => patch.action !== 'delete')
      .map((patch) => [patch.rowKey, { rowKey: patch.rowKey, data: patch.row, isComment: patch.isComment }]),
  );
  return invokeSaveCommand(
    'save_csv_patch',
    {
      payload: {
        rowOrder,
        baseVersions,
        sessionId,
        modRoot,
        table,
        patches,
        associatedSpecs,
        ...(jsonWrite ? { jsonWrite } : {}),
      } satisfies CsvSave,
    },
    captureSaveEdits(before, after),
    request,
  );
}

export function prepareCsvAssociatedSpecs(sessionId: string, table: CsvTableKey, changes: AssociatedSpecChange[]) {
  return invokeCommand<AssociatedSpecPreparation[]>('prepare_csv_associated_specs', {
    payload: { sessionId, table, changes },
  });
}

export function queryTableIndex(
  sessionId: string,
  table: CsvTableKey,
  initialCount: number,
  search: string | null,
  searchField: CsvSearchField,
  signal?: AbortSignal,
): Promise<DeepReadonly<CsvTableIndex>> {
  return readTableIndex.read(sessionId, { table, initialCount, search, searchField }, signal);
}

export function queryTableRows(
  sessionId: string,
  table: CsvTableKey,
  rowKeys: string[],
  signal?: AbortSignal,
): Promise<DeepReadonly<CsvTableRowsRead>> {
  return readLiveSessionQuery(readTableRows, sessionId, { table, rowKeys }, signal);
}

export function querySessionCsvRowPreview(
  sessionId: string,
  table: CsvTableKey,
  rowKey: string,
  signal?: AbortSignal,
): Promise<DeepReadonly<CsvRowPreview>> {
  return readRowPreview.read(sessionId, { table, rowKey }, signal);
}

export async function queryTableRowPreviewDataUrl(
  sessionId: string,
  table: CsvTableKey,
  rowKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const resource = (await querySessionCsvRowPreview(sessionId, table, rowKey, signal)).resourceRef;
  if (!resource) return '';
  return (await queryResourceDataUrls(sessionId, [resource], signal))[0] ?? '';
}

export function hasTableInvalidation(
  invalidation: ProjectInvalidation,
  queryKind: 'csv-table-window' | 'csv-row-preview',
  table: string,
): boolean {
  return (
    invalidation.session || invalidation.queryScopes.some((scope) => scope.kind === queryKind && (!scope.table || scope.table === table))
  );
}
