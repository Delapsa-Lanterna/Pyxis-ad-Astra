import type { ProjectSessionId, ResourceRef, SourceOptionGroup, RowData } from '@/shared/types';
import type { DeepReadonly } from '@/shared/types';

export interface SchemaRuntimeContext {
  composition?: {
    local: () => RowData;
    sources: () => import('@/shared/types').JsonComposition | undefined;
    apply: (path: string[], value: import('@/shared/types').JsonValue | undefined) => void;
  };
  modRoot: string;
  sessionId: ProjectSessionId;
  sourceContextKey?: string;
  readValue?: () => RowData;
  missionId?: string;
  querySourceOptions?: (source: string, signal?: AbortSignal) => Promise<DeepReadonly<SourceOptionGroup[]>>;
  subscribeSourceOptionInvalidation?: (source: string, resources: () => ResourceRef[], listener: () => void | Promise<void>) => () => void;
}
