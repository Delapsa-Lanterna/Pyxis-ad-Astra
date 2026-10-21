import type { Ref } from 'vue';
import type { FieldInputs } from './field-inputs';
import type { WriteResult } from '@/shared/types';

export type DraftHistoryResult = boolean | null;
export type DocumentSaveResult = { status: 'saved'; receipt: WriteResult<unknown> } | { status: 'noop' | 'cancelled' };

export interface DocumentEditorActions<TTarget extends { sessionId: string; modRoot: string }> {
  target: Readonly<Ref<TTarget | null>>;
  targetKey: Readonly<Ref<string | null>>;
  inputs: FieldInputs;
  dirty: Readonly<Ref<boolean>>;
  saving: Readonly<Ref<boolean>>;
  pendingSynchronization: Readonly<Ref<boolean>>;
  canUndo: Readonly<Ref<boolean>>;
  canRedo: Readonly<Ref<boolean>>;
  undo: () => Promise<DraftHistoryResult>;
  redo: () => Promise<DraftHistoryResult>;
  save: () => Promise<DocumentSaveResult>;
  waitForSave: () => Promise<boolean>;
}
