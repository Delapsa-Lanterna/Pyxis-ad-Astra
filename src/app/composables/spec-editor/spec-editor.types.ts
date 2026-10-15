import type { Ref } from 'vue';
import type { EditContext, SpecEditorKind, RowData, SpecEditorData } from '@/shared/types';

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
  read: (sessionId: string, id: string, signal?: AbortSignal) => Promise<TData>;
  project: (data: TData) => RowData;
  accept: (data: TData, spec: RowData) => TData;
  idField: string;
}
