import type { DeepReadonly, JsonComposition, JsonValue, ProjectSessionId, ResourceRef, RowData, SourceOptionGroup } from '@/shared/types';
import type { FilePath, DocumentEdit } from '@/shared/types';
import type { JsonDocument } from '@/domain/json-document';
import type { FieldSchema } from '@/domain/schema/schema.types';
import { compositionOrigin, compositionPath, compositionValue } from '@/domain/json-composition';

export interface FieldEditorContext {
  partial?: boolean;
  document?: JsonDocument;
  applyDocumentEdit?: (edit: DocumentEdit) => void;
  documentRoot?: string[];
  composition?: {
    local: () => RowData;
    sources: () => JsonComposition | undefined;
    apply: (path: string[], value: JsonValue | undefined) => void;
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
export function fieldSchemaForContext<T extends FieldSchema>(field: T, context?: FieldEditorContext | null): T {
  return context?.partial ? { ...field, required: false, requiredWhen: undefined, partial: true } : field;
}
export function fieldCompositionOrigin(context: FieldEditorContext | null | undefined, path: string): string | null {
  const composition = context?.composition,
    sources = composition?.sources();
  return composition && sources ? compositionOrigin(composition.local(), sources, compositionPath(path)) : null;
}
export function fieldDocumentPath(context: FieldEditorContext, path: string): FilePath | null {
  const parts = compositionPath(path),
    root = context.documentRoot ?? [];
  if (!root.every((part, index) => parts[index] === part)) return null;
  const effective = context.readValue?.();
  const local = context.composition?.local();
  const mapped: string[] = [];
  for (const [index, part] of parts.entries()) {
    const parent = effective && compositionValue(effective, parts.slice(0, index));
    if (local && Array.isArray(parent)) {
      const own = compositionValue(local, mapped);
      if (!Array.isArray(own)) return null;
      const localIndex = Number(part) - (parent.length - own.length);
      if (localIndex < 0) return null;
      mapped.push(String(localIndex));
    } else mapped.push(part);
  }
  return mapped.slice(root.length);
}
export function fieldOriginalText(context: FieldEditorContext | null | undefined, path: string): string | null {
  if (!context?.document) return null;
  const target = fieldDocumentPath(context, path);
  return target ? context.document.raw(target) : null;
}
