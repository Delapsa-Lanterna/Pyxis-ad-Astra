import type { ProjectSessionId, ResourceRef, SourceOptionGroup, RowData, JsonComposition, JsonValue } from '@/shared/types';
import type { DeepReadonly } from '@/shared/types';
import type { FieldSchema } from '../schema/schema.types';
import { compositionOrigin, compositionPath } from '../json-composition';

export function fieldSchemaForContext<T extends FieldSchema>(field: T, context?: FieldEditorContext | null): T {
  return context?.partial ? { ...field, required: false, requiredWhen: undefined, partial: true } : field;
}

export interface FieldEditorContext {
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

export function fieldCompositionOrigin(context: FieldEditorContext | null | undefined, path: string): string | null {
  const composition = context?.composition;
  const sources = composition?.sources();
  return composition && sources ? compositionOrigin(composition.local(), sources, compositionPath(path)) : null;
}
