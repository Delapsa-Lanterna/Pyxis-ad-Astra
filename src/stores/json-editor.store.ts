import type { JsonDocumentRecord, JsonDocumentKind, ConfigDocumentTarget } from '@/domain/json-editor/json-document-definitions';
import type { RowData } from '@/shared/types';
import type { DocumentEditorActions } from '@/shared/runtime/document-editor';
import { defineStore } from 'pinia';
import { ref, shallowReactive, shallowRef, type Ref } from 'vue';

export type JsonEditorHandle = DocumentEditorActions<ConfigDocumentTarget>;
export interface JsonDocumentState {
  target: Readonly<Ref<ConfigDocumentTarget | null>>;
  draftValue: Readonly<Ref<RowData>>;
  record: Readonly<Ref<JsonDocumentRecord>>;
  dirty: Readonly<Ref<boolean>>;
  sourceMissing: Readonly<Ref<boolean>>;
  sourceTarget: Readonly<Ref<ConfigDocumentTarget>>;
}
export const useJsonEditorStore = defineStore('json-editor', () => {
  const selections = new Map<string, Ref<string | null>>();
  function selection(sessionId: string, kind: JsonDocumentKind) {
    const key = JSON.stringify([sessionId, kind]);
    if (!selections.has(key)) selections.set(key, ref(null));
    return selections.get(key)!;
  }
  const active = shallowRef<JsonEditorHandle | null>(null);
  const documents = shallowReactive(
    new Map<string, { sessionId: string; modRoot: string; value: { session: JsonDocumentState }; dispose: () => void }>(),
  );
  function retainDocument<T extends { session: JsonDocumentState }>(
    key: string,
    sessionId: string,
    modRoot: string,
    create: () => { value: T; dispose: () => void },
  ): T {
    const existing = documents.get(key);
    if (existing) return existing.value as T;
    const document = create();
    documents.set(key, { sessionId, modRoot, ...document });
    return document.value;
  }
  function releaseDocument(key: string) {
    const document = documents.get(key)!;
    documents.delete(key);
    document.dispose();
  }
  function documentStates(sessionId: string) {
    return [...documents.values()].filter((document) => document.sessionId === sessionId).map((document) => document.value.session);
  }
  function releaseEntity(sessionId: string, kind: string, id: string) {
    for (const [key, document] of documents) {
      const target = document.value.session.target.value;
      if (document.sessionId === sessionId && target?.kind === kind && target.id === id) releaseDocument(key);
    }
  }
  function rekeyDocument(previousKey: string, nextKey: string) {
    const document = documents.get(previousKey)!;
    documents.delete(previousKey);
    documents.set(nextKey, document);
  }
  function releaseSession(sessionId: string) {
    for (const key of selections.keys()) if ((JSON.parse(key) as string[])[0] === sessionId) selections.delete(key);
    if (active.value?.target.value?.sessionId === sessionId) active.value = null;
    for (const [key, document] of documents) if (document.sessionId === sessionId) releaseDocument(key);
  }
  function activate(editor: JsonEditorHandle) {
    active.value = editor;
  }
  function deactivate(editor: JsonEditorHandle) {
    if (active.value === editor) active.value = null;
  }
  return {
    active,
    documentStates,
    activate,
    deactivate,
    retainDocument,
    rekeyDocument,
    selection,
    releaseEntity,
    releaseSession,
  };
});
