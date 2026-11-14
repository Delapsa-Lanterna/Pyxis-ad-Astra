import { invokeCommand } from '@/shared/runtime/command.runtime';
import { readLiveSessionQuery, type SessionQueryDefinition } from './query-cache.service';
import type { EngineRenderAssets, ProjectInvalidation, RowData } from '@/shared/types';
import { normalizeFsPath } from '@/shared/lib/paths';

export function hasEngineAssetsInvalidation(invalidation: ProjectInvalidation) {
  return (
    invalidation.session ||
    invalidation.resources.some(({ relPath }) => {
      const path = normalizeFsPath(relPath),
        target = 'data/config/engine_styles.json';
      return path === target || target.startsWith(path + '/');
    })
  );
}
const read = {
  queryKind: 'engine-render-assets',
  invalidates: (_parameters, invalidation) => hasEngineAssetsInvalidation(invalidation),
  load: ({ sessionId, parameters }) => invokeCommand<EngineRenderAssets>('query_engine_render_assets', { sessionId, ...parameters }),
} satisfies SessionQueryDefinition<{ inlineStyles: RowData[] }, EngineRenderAssets>;
export const queryEngineRenderAssets = (sessionId: string, inlineStyles: RowData[], signal?: AbortSignal) =>
  readLiveSessionQuery(read, sessionId, { inlineStyles }, signal);
