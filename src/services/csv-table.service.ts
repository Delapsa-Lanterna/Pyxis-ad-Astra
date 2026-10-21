import type {
  CsvTableIndex,
  CsvTableRowsRead,
  CsvRowPreview,
  CsvTableIndexPayload,
  CsvTableRowsPayload,
  CsvRowPreviewPayload,
  SaveCsvPatchPayload,
  AssociatedSpecChange,
  AssociatedSpecWrite,
  CsvSearchField,
  CsvRowPatch,
  JsonWriteOptions,
  CsvTableKey,
  WriteResult,
  DeepReadonly,
} from '@/shared/types';

import { querySessionEntityEditTarget, querySessionEntityIdentityIntent } from '@/services/entity-query.service';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import { createCachedSessionQuery, createLiveSessionQuery } from '@/services/query-cache.service';
import type { QueryCacheInvalidationEvent } from '@/services/query-cache.service';
import { queryResourceDataUrls } from '@/services/resource-media.service';

import { associatedSpecKind } from '@/domain/csv-editor/associated-specs';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';

const readTableIndex = createCachedSessionQuery<Omit<CsvTableIndexPayload, 'sessionId'>, CsvTableIndex>({
  queryKind: 'csv-table-window',
  load: ({ sessionId, parameters }) =>
    invokeCommand<CsvTableIndex>('query_csv_table_index', { payload: { sessionId, ...parameters } satisfies CsvTableIndexPayload }),
  invalidates: (parameters, invalidation) =>
    invalidation.queryScopes.some((scope) => scope.kind === 'csv-table-window' && (!scope.table || scope.table === parameters.table)),
});

const readTableRows = createLiveSessionQuery<Omit<CsvTableRowsPayload, 'sessionId'>, CsvTableRowsRead>({
  queryKind: 'csv-table-rows',
  load: ({ sessionId, parameters }) =>
    invokeCommand<CsvTableRowsRead>('query_csv_table_rows', { payload: { sessionId, ...parameters } satisfies CsvTableRowsPayload }),
  invalidates: (parameters, invalidation) =>
    invalidation.queryScopes.some((scope) => scope.kind === 'csv-table-window' && (!scope.table || scope.table === parameters.table)),
});

const readRowPreview = createCachedSessionQuery<Omit<CsvRowPreviewPayload, 'sessionId'>, CsvRowPreview>({
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
  baseVersions: import('@/shared/types').FileVersion[] = [],
  rowOrder: import('@/shared/types').CsvRowOrderEntry[] | null = null,
): Promise<WriteResult> {
  return invokeCommand('save_csv_patch', {
    payload: {
      rowOrder,
      baseVersions,
      sessionId,
      modRoot,
      table,
      patches,
      associatedSpecs,
      ...(jsonWrite ? { jsonWrite } : {}),
    } satisfies SaveCsvPatchPayload,
  });
}

export async function captureAssociatedSpecTarget(sessionId: string, table: CsvTableKey, change: AssociatedSpecChange) {
  const kind = associatedSpecKind(table)!;
  const sourceId = change.action === 'rename' ? change.previousId : change.action === 'delete' ? change.id : change.create.id;
  const nextId = change.action === 'delete' ? change.id : change.create.id;
  const info = cloneQuerySnapshot<import('@/shared/types').EntityEditInfo>(await querySessionEntityEditTarget(sessionId, kind, sourceId));
  const intent =
    change.action === 'delete'
      ? null
      : cloneQuerySnapshot<import('@/shared/types').EntityIdentityIntent>(
          await querySessionEntityIdentityIntent(sessionId, info.target, nextId),
        );
  return {
    target: info.target,
    nextWrite: intent?.nextWrite ?? info.target.write,
    versions: [...info.baseVersions, ...(intent ? [intent.destinationVersion] : [])],
  };
}

export function queryTableIndex(
  sessionId: string,
  table: CsvTableKey,
  initialCount: number,
  search: string | null,
  searchField: CsvSearchField,
  signal?: AbortSignal,
): Promise<DeepReadonly<CsvTableIndex>> {
  return readTableIndex(sessionId, { table, initialCount, search, searchField }, signal);
}

export function queryTableRows(
  sessionId: string,
  table: CsvTableKey,
  rowKeys: string[],
  signal?: AbortSignal,
): Promise<DeepReadonly<CsvTableRowsRead>> {
  return readTableRows(sessionId, { table, rowKeys }, signal);
}

export function querySessionCsvRowPreview(
  sessionId: string,
  table: CsvTableKey,
  rowKey: string,
  signal?: AbortSignal,
): Promise<DeepReadonly<CsvRowPreview>> {
  return readRowPreview(sessionId, { table, rowKey }, signal);
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

export function hasTableInvalidation(event: QueryCacheInvalidationEvent, queryKind: 'csv-table-window', table: string): boolean {
  return (
    event.scope === 'session' ||
    !!event.invalidation?.queryScopes.some((scope) => scope.kind === queryKind && (!scope.table || scope.table === table))
  );
}
