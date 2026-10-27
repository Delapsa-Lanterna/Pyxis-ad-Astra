import { subscribeProjectChanges, projectChangeSessionId } from '@/orchestrators/project-sync.orchestrator';
import { hasSourceInvalidation } from '@/services/source-options.service';
import { computed } from 'vue';
import { querySourceOptionCatalog } from '@/services/source-options.service';

import { hasResourceInvalidation } from '@/services/resource-media.service';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { ProjectManifest } from '@/shared/types';

export function useSchemaRuntimeContext(manifest: () => ProjectManifest | null | undefined) {
  return computed<SchemaRuntimeContext | null>(() => {
    const active = manifest();
    return active ? createSchemaRuntimeContext(active.modRoot, active.sessionId) : null;
  });
}

export function createSchemaRuntimeContext(modRoot: string, sessionId: string): SchemaRuntimeContext {
  return {
    modRoot,
    sessionId,
    querySourceOptions: (source, signal) => querySourceOptionCatalog(sessionId, source, signal),
    subscribeSourceOptionInvalidation: (source, resources, listener) => {
      return subscribeProjectChanges((change) => {
        if (projectChangeSessionId(change) !== sessionId || change.kind === 'closed') return;
        const invalidation = change.projection.invalidation;
        if (hasSourceInvalidation(invalidation, source) || hasResourceInvalidation(invalidation, resources())) listener();
      });
    },
  };
}
