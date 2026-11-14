import type {
  SourceOptionGroup,
  InvalidatedQueryScope,
  SourceCatalogPayload,
  ImageSourceOptionsPayload,
  DeepReadonly,
} from '@/shared/types';

import type { ProjectInvalidation } from '@/shared/types';

import { CONFIG_FIELD_SOURCES, isConfigFieldSource, parseCsvFieldSource } from '@/domain/schema/schema-source-definitions';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import { pathBelongsToRoot } from '@/shared/lib/paths';
import { CachedSessionQuery, readLiveSessionQuery, type SessionQueryDefinition } from '@/services/query-cache.service';

const readImageOptions = {
  queryKind: 'image-source-options',
  load: ({ sessionId, parameters }) =>
    invokeCommand('query_image_source_options', { payload: { sessionId, ...parameters } satisfies ImageSourceOptionsPayload }),
  invalidates: (parameters, invalidation) => hasSourceInvalidation(invalidation, parameters),
} satisfies SessionQueryDefinition<Omit<ImageSourceOptionsPayload, 'sessionId'>, SourceOptionGroup[]>;

function hasImageSourceInvalidation(invalidation: ProjectInvalidation, directories: readonly string[], missionId?: string | null): boolean {
  if (invalidation.session) return true;
  const roots = directories.map((directory) =>
    [missionId ? 'data/missions/' + missionId : '', directory === '.' ? '' : directory].filter(Boolean).join('/'),
  );
  return invalidation.resources.some(
    ({ relPath }) =>
      relPath === '' || roots.some((root) => root === '' || pathBelongsToRoot(relPath, root) || pathBelongsToRoot(root, relPath)),
  );
}

export function queryImageSourceOptions(sessionId: string, directories: string[], missionId: string | null, signal?: AbortSignal) {
  return readLiveSessionQuery(readImageOptions, sessionId, { directories, missionId }, signal);
}

const readSourceOptions = new CachedSessionQuery<Omit<SourceCatalogPayload, 'sessionId'>, SourceOptionGroup[]>({
  queryKind: 'csv-source-options',
  load: ({ sessionId, parameters }) =>
    invokeCommand<SourceOptionGroup[]>('query_csv_source_options', {
      payload: { sessionId, ...parameters } satisfies SourceCatalogPayload,
    }),
  invalidates: (parameters, invalidation) => hasSourceInvalidation(invalidation, parameters.source),
});

export async function querySourceOptionCatalog(
  sessionId: string,
  source: string,
  signal?: AbortSignal,
): Promise<DeepReadonly<SourceOptionGroup[]>> {
  return readSourceOptions.read(sessionId, { source }, signal);
}

export function hasSourceInvalidation(
  invalidation: ProjectInvalidation,
  source: string | Pick<ImageSourceOptionsPayload, 'directories' | 'missionId'>,
): boolean {
  if (typeof source !== 'string') return hasImageSourceInvalidation(invalidation, source.directories, source.missionId);
  return (
    invalidation.session ||
    invalidation.queryScopes.some((scope) => matchesSourceOptionsScope(scope, source)) ||
    (isConfigFieldSource(source) &&
      invalidation.resources.some(
        ({ relPath }) =>
          relPath === '' || relPath === CONFIG_FIELD_SOURCES[source] || CONFIG_FIELD_SOURCES[source].startsWith(relPath + '/'),
      ))
  );
}
function matchesSourceOptionsScope(scope: InvalidatedQueryScope, source: string | null): boolean {
  if (scope.kind !== 'csv-source-options') return false;
  if (scope.source) return scope.source === source;
  if (scope.table) return parseCsvFieldSource(source)?.table === scope.table;
  return true;
}
