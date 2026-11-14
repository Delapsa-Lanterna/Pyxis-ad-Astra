import type {
  CsvTableIndex,
  CsvTableRowsRead,
  CsvRowPreview,
  CsvRowResources,
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
  CsvRowRecord,
  AssociatedSpecPreparation,
  CsvValidationRequest,
  CsvValidationContext,
  EntityFileLocation,
} from '@/shared/types';

import { invokeCommand, invokeSaveCommand, type SaveCommandRequest } from '@/shared/runtime/command.runtime';
import { CachedSessionQuery, readLiveSessionQuery, type SessionQueryDefinition } from '@/services/query-cache.service';
import type { ProjectInvalidation } from '@/shared/types';
import { queryResourceDataUrls } from '@/services/resource-media.service';

import { csvValidationDefinitions } from '@/domain/csv-editor/csv-validation';
import { hasCsvValidationInvalidation } from '@/domain/csv-editor/csv-rule-context';
import { infoLog } from '@/shared/runtime/app-log-queue';
import { logIdentity } from '@/shared/lib/log-fields';
import { cell } from '@/shared/lib/starsector';
import { prepareCsvValue } from '@/domain/schema/csv-value-validation';
import { getCsvColumnSchemas } from '@/domain/schema/csv-schema-registry';

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

const readRowResources = {
  queryKind: 'csv-row-preview',
  load: ({ sessionId, parameters }) => invokeCommand<CsvRowResources>('query_csv_row_resources', { payload: { sessionId, ...parameters } }),
  // Grid drafts capture image identities; the media owner handles file invalidation.
  invalidates: () => false,
} satisfies SessionQueryDefinition<Omit<CsvTableRowsPayload, 'sessionId'> & { drafts: CsvRowRecord[] }, CsvRowResources>;

const readValidation = new CachedSessionQuery<CsvValidationRequest, CsvValidationContext>({
  queryKind: 'csv-table-window',
  load: ({ sessionId, parameters }) => invokeCommand('query_csv_validation', { payload: { sessionId, ...parameters } }),
  invalidates: (parameters, invalidation) =>
    hasCsvValidationInvalidation(
      invalidation,
      parameters,
      () => invalidation.resources.length > 0 || invalidation.queryScopes.some((scope) => scope.kind === 'csv-source-options'),
    ),
});
export function queryCsvValidation(sessionId: string, request: CsvValidationRequest, signal?: AbortSignal) {
  return readValidation.read(sessionId, request, signal);
}

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
): Promise<WriteResult<CsvTableRowsRead>> {
  request ??= { id: crypto.randomUUID() };
  const requestId = request.id;
  const definitions = new Map(getCsvColumnSchemas(table).map((column) => [column.key, column]));
  const prepared = patches.map((patch) => {
    const row = { ...patch.row };
    for (const key of patch.columns) {
      const definition = definitions.get(key);
      row[key] = definition ? prepareCsvValue(definition, cell(row[key])) : cell(row[key]);
    }
    return { ...patch, row };
  });
  const idField = table === 'simOpponents' ? 'variant id' : 'id';
  for (const [index, patch] of patches.entries())
    infoLog('tables.row_submitted', () => ({
      requestId,
      sessionId,
      modRoot,
      table,
      member: String(index + 1),
      members: String(patches.length),
      action: patch.action === 'delete' ? 'delete' : originalRows[patch.rowKey] ? 'update' : 'create',
      rowKey: patch.rowKey,
      idField,
      previousId: String(originalRows[patch.rowKey]?.data[idField] ?? ''),
      nextId: patch.action === 'delete' ? '' : String(patch.row[idField] ?? ''),
      recordType: String((patch.action === 'delete' ? originalRows[patch.rowKey]?.data : patch.row)?.type ?? ''),
    }));
  for (const spec of associatedSpecs)
    infoLog('tables.associated_spec_submitted', () => ({
      requestId,
      sessionId,
      modRoot,
      table,
      ...logIdentity(spec.change),
      ...logIdentity(spec.target, 'target'),
      mode: spec.resolution?.mode ?? 'delete',
    }));
  return invokeSaveCommand(
    'save_csv_patch',
    {
      payload: {
        rowOrder,
        baseVersions,
        sessionId,
        modRoot,
        table,
        patches: prepared,
        associatedSpecs,
        ...(jsonWrite ? { jsonWrite } : {}),
      } satisfies CsvSave,
    },
    [],
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
  source?: EntityFileLocation,
): Promise<DeepReadonly<CsvTableIndex>> {
  return readTableIndex.read(
    sessionId,
    { table, initialCount, search, searchField, validationColumns: csvValidationDefinitions[table].columns, ...(source ? { source } : {}) },
    signal,
  );
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

export function queryCsvRowResources(
  sessionId: string,
  table: CsvTableKey,
  rowKeys: string[],
  drafts: CsvRowRecord[],
  signal?: AbortSignal,
): Promise<DeepReadonly<CsvRowResources>> {
  return readLiveSessionQuery(readRowResources, sessionId, { table, rowKeys, drafts }, signal);
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
