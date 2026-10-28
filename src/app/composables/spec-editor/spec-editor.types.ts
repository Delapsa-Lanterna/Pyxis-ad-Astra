import type { Ref } from 'vue';
import type { EditContext, SpecEditorKind, RowData, SpecEditorData } from '@/shared/types';
import type { SpecIssue } from '@/domain/spec-editor/spec-validation';

export interface SpecEditorTarget {
  id: string;
  kind: SpecEditorKind;
  modRoot: string;
  sessionId: string;
}

export interface SpecEditorInput {
  target: Readonly<Ref<SpecEditorTarget | null>>;
  draft: Readonly<Ref<RowData>>;
  context: Readonly<Ref<EditContext | null>>;
}

export interface SpecEditorDefinition<TData extends SpecEditorData> {
  validate?: (value: RowData) => SpecIssue[];
  read: (sessionId: string, id: string, signal?: AbortSignal) => Promise<TData>;
  idField: string;
}
