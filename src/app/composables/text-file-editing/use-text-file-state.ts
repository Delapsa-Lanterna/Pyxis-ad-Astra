import { computed } from 'vue';
import {
  useEditTargetDraftSession,
  type EditTargetDraftSession,
  type EditTargetDraftSessionOptions,
} from '@/app/composables/use-edit-target-draft-session';
import {
  createTextDocument,
  readTextContent,
  sameTextContent,
  writeTextContent,
  type TextContent,
  type TextDocument,
} from '@/shared/runtime/text-document';
import { beginSavedWrite } from '@/orchestrators/project-sync.orchestrator';
import { loadTextFile, saveTextFile } from '@/services/text-file-editing.service';
import { waitForRead } from '@/shared/runtime/read-request';
import { useSettingsStore } from '@/stores/settings.store';
import type { LoadTextFilePayload, EntityTargetSnapshot, WriteResult } from '@/shared/types';

export interface TextFileMeta {
  entity: EntityTargetSnapshot | null;
  receipt: WriteResult | null;
}
export interface TextFileState<TTarget> {
  session: EditTargetDraftSession<TextContent, TTarget, TextFileMeta>;
  document: TextDocument;
}
export function useTextFileState<TTarget extends LoadTextFilePayload>(
  options: Pick<EditTargetDraftSessionOptions<TextContent, TTarget, TextFileMeta>, 'targetKey' | 'acceptSaved'> & {
    readCompleted?: () => void;
    readFailed?: (error: unknown) => void;
  },
  path: (target: TTarget | null) => string,
  changed?: () => void,
): TextFileState<TTarget> {
  const settings = useSettingsStore();
  const session: EditTargetDraftSession<TextContent, TTarget, TextFileMeta> = useEditTargetDraftSession({
    emptyValue: readTextContent(''),
    clone: (text) => text,
    equals: sameTextContent,
    mapSavedDraft: (draft) => draft,
    beginSave: beginSavedWrite,
    targetKey: options.targetKey,
    acceptSaved: options.acceptSaved,
    savedContent: (snapshot) => ({ ...snapshot, meta: { ...snapshot.meta, receipt: null } }),
    captureSave: () => document.separateHistory(),
    async load(target, signal) {
      try {
        const loaded = await waitForRead(loadTextFile(target.sessionId, target.modRoot, target.path), target, signal);
        signal!.throwIfAborted();
        options.readCompleted?.();
        return {
          target: { ...target, path: loaded.path },
          value: readTextContent(loaded.text),
          baseVersions: loaded.baseVersions,
          meta: { entity: loaded.entity, receipt: null },
        };
      } catch (error) {
        if (!signal!.aborted) options.readFailed?.(error);
        throw error;
      }
    },
    async save(target, draft, baseVersions, _original, request) {
      const text = writeTextContent(draft);
      const receipt = await saveTextFile(target.sessionId, target.modRoot, target.path, text, baseVersions, request);
      const saved = receipt.content?.value?.text;
      return {
        target,
        value: typeof saved === 'string' && saved !== text ? readTextContent(saved) : draft,
        baseVersions: receipt.baseVersions,
        requestId: receipt.requestId,
        meta: { entity: session.baselineSnapshot.value!.meta.entity, receipt },
      };
    },
  });
  const document = createTextDocument(
    session.draftValue,
    session.context,
    computed(() => settings.editHistoryLimit),
    session.inputs,
    changed,
    computed(() => path(session.currentTarget.value)),
  );
  return { session, document };
}
