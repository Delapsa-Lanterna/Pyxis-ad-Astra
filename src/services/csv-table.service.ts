import type {
  CsvTableWindow,
  CsvRowPreview,
  CsvTableWindowPayload,
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
import { createCachedSessionQuery } from '@/services/query-cache.service';
import type { QueryCacheInvalidationEvent } from '@/services/query-cache.service';
import { queryResourceDataUrls } from '@/services/resource-cache.service';

import { associatedSpecKind } from '@/domain/tables/associated-specs';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';

const readTableWindow = createCachedSessionQuery<Omit<CsvTableWindowPayload, 'sessionId'>, CsvTableWindow>({
  queryKind: 'csv-table-window',
  load: ({ sessionId, parameters }) =>
    invokeCommand<CsvTableWindow>('query_csv_table_window', { payload: { sessionId, ...parameters } satisfies CsvTableWindowPayload }),
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

export function queryTableWindow(
  sessionId: string,
  table: CsvTableKey,
  start: number,
  count: number,
  search: string | null,
  searchField: CsvSearchField,
  signal?: AbortSignal,
): Promise<DeepReadonly<CsvTableWindow>> {
  const parameters = { table, start, count, search, searchField };
  return readTableWindow(sessionId, parameters, signal);
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
