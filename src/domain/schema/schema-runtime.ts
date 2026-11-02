import type { ProjectSessionId, ResourceRef, SourceOptionGroup, RowData, JsonComposition, JsonValue } from '@/shared/types';
import type { DeepReadonly } from '@/shared/types';
import type { FieldSchema } from './schema.types';

export function schemaContextField<T extends FieldSchema>(field: T, context?: SchemaRuntimeContext | null): T {
  return context?.partial ? { ...field, required: false, requiredWhen: undefined, partial: true } : field;
}

export interface SchemaRuntimeContext {
  partial?: boolean;
  composition?: {
    local: () => RowData;
    sources: () => JsonComposition | undefined;
    apply: (path: string[], value: JsonValue | undefined) => void;
    /** Path of the composed file object inside the local value; empty when the value is the file itself. */
    root?: string[];
  };
  modRoot: string;
  sessionId: ProjectSessionId;
  sourceContextKey?: string;
  readValue?: () => RowData;
  missionId?: string;
  querySourceOptions?: (source: string, signal?: AbortSignal) => Promise<DeepReadonly<SourceOptionGroup[]>>;
  subscribeSourceOptionInvalidation?: (source: string, resources: () => ResourceRef[], listener: () => void | Promise<void>) => () => void;
}
