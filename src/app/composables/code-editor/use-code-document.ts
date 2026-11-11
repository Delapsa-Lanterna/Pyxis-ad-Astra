import { computed, effectScope, shallowRef } from 'vue';
import { useEditTargetDraftSession, type EditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { createTextDocument, readTextContent, sameTextContent, writeTextContent, type TextContent } from '@/shared/runtime/text-document';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useSettingsStore } from '@/stores/settings.store';
import { loadTextFile, saveTextFile } from '@/services/text-editor.service';
import { beginSavedWrite } from '@/orchestrators/project-sync.orchestrator';
import { normalizeFsPath } from '@/shared/lib/paths';
import type { CodeEditorOpen, EntityTargetSnapshot, ErrorDiagnostic, WriteResult } from '@/shared/types';
import { waitForRead } from '@/shared/runtime/read-request';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';

export interface CodeDocumentGroup {
  release: () => void;
  capture: () => () => boolean;
  save: () => Promise<DocumentSaveResult>;
  wait: () => Promise<boolean>;
  undo: () => boolean;
  redo: () => boolean;
  discard: () => void;
}

export function createCodeDocument(owner: Pick<CodeEditorOpen, 'sessionId' | 'modRoot'>, path: string, source?: string) {
  const readOnly = source !== undefined;
  const scope = effectScope();
  let released = false;
  const document = scope.run(() => {
    type Target = typeof owner & { path: string };
    type Meta = { entity: EntityTargetSnapshot | null; receipt: WriteResult | null };
    const settings = useSettingsStore();
    const commands = useSaveCommandStore();
    const group = shallowRef<CodeDocumentGroup | null>(null);
    const pendingPath = shallowRef<string | null>(null);
    const session: EditTargetDraftSession<TextContent, Target, Meta> = useEditTargetDraftSession<TextContent, Target, Meta>({
      emptyValue: readTextContent(''),
      clone: (text) => text,
      equals: sameTextContent,
      mapSavedDraft: (draft) => draft,
      captureSave: () => document.separateHistory(),
      targetKey: (target) => `${target.sessionId}\n${normalizeFsPath(target.path)}`,
      beginSave: beginSavedWrite,
      savedContent: (snapshot) => ({ ...snapshot, meta: { ...snapshot.meta, receipt: null } }),
      load: async (target, signal) => {
        const loaded = await waitForRead(loadTextFile(target.sessionId, target.modRoot, target.path), target, signal);
        signal!.throwIfAborted();
        return {
          target: { ...target, path: loaded.path },
          value: readTextContent(loaded.text),
          baseVersions: loaded.baseVersions,
          meta: { entity: loaded.entity, receipt: null },
        };
      },
      save: async (target, draft, versions, _original, request) => {
        const text = writeTextContent(draft);
        const result = await saveTextFile(target.sessionId, target.modRoot, target.path, text, versions, request);
        return {
          target,
          value:
            typeof result.content?.value?.text === 'string' && result.content.value.text !== text
              ? readTextContent(result.content.value.text)
              : draft,
          baseVersions: result.baseVersions,
          requestId: result.requestId,
          meta: { entity: session.baselineSnapshot.value!.meta.entity, receipt: result },
        };
      },
    });
    const document = createTextDocument(
      session.draftValue,
      session.context,
      computed(() => settings.editHistoryLimit),
      session.inputs,
      undefined,
      computed(() => session.currentTarget.value?.path ?? path),
    );
    const participant = {
      targetKey: session.currentTargetKey,
      modRoot: computed(() => owner.modRoot),
      saving: session.saving,
      waitForSave: () => group.value?.wait() ?? session.waitForSave(),
      editing: {
        targets: computed(() => [
          ...(session.baselineSnapshot.value?.baseVersions.map((version) => ({ ...owner, path: version.path })) ?? []),
          ...(pendingPath.value ? [{ ...owner, path: pendingPath.value }] : []),
        ]),
        label: path,
        dirty: computed(
          () =>
            session.dirty.value ||
            (!!pendingPath.value && normalizeFsPath(pendingPath.value) !== normalizeFsPath(session.currentTarget.value?.path ?? path)),
        ),
        draftSession: session,
        captureContent: document.captureContent,
        save: async () => {
          if (group.value) return group.value.save();
          if (!session.dirty.value) return { status: 'noop' as const };
          const saved = await session.saveDraft();
          return saved ? { status: 'saved' as const, receipt: saved.meta.receipt! } : { status: 'cancelled' as const };
        },
      },
    };
    const unregister = readOnly ? () => {} : commands.registerSaveParticipant(participant);
    return {
      session,
      readOnly,
      group,
      pendingPath,
      document,
      participant,
      dirty: participant.editing.dirty,
      problem: shallowRef<ErrorDiagnostic | null>(null),
      path: computed(() => pendingPath.value ?? session.currentTarget.value?.path ?? path),
      load: async () => {
        if (readOnly)
          session.loadBaseForTarget({
            target: { ...owner, path },
            value: readTextContent(source),
            baseVersions: [],
            meta: { entity: null, receipt: null },
          });
        else await session.loadTarget({ ...owner, path });
      },
      save: () => (readOnly ? Promise.resolve({ status: 'noop' as const }) : commands.requestSave(participant)),
      setText: (text: string) => {
        if (!readOnly) document.replaceSource(text);
      },
      undo: () => !readOnly && (group.value?.undo() || document.undo()),
      redo: () => !readOnly && (group.value?.redo() || document.redo()),
      dispose() {
        if (released) return;
        released = true;
        unregister();
        document.dispose();
        session.dispose();
        scope.stop();
      },
    };
  })!;
  return document;
}
export type CodeDocument = ReturnType<typeof createCodeDocument>;
