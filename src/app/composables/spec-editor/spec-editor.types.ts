import type { Ref } from 'vue';
import type { EditContext, SpecEditorKind, RowData, SpecEditorData, FieldProblem } from '@/shared/types';

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
  normalize?: (value: RowData) => RowData;
  validate?: (value: RowData, partial?: boolean) => FieldProblem[];
  read: (sessionId: string, id: string, signal?: AbortSignal) => Promise<TData>;
  idField: string;
}
