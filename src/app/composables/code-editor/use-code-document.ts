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

export function createCodeDocument(owner: Pick<CodeEditorOpen, 'sessionId' | 'modRoot'>, path: string) {
  const scope = effectScope();
  let released = false;
  const document = scope.run(() => {
    type Target = typeof owner & { path: string };
    type Meta = { entity: EntityTargetSnapshot | null; receipt: WriteResult | null };
    const settings = useSettingsStore();
    const commands = useSaveCommandStore();
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
    );
    const participant = {
      targetKey: session.currentTargetKey,
      modRoot: computed(() => owner.modRoot),
      saving: session.saving,
      waitForSave: session.waitForSave,
      editing: {
        targets: computed(() => session.baselineSnapshot.value?.baseVersions.map((version) => ({ ...owner, path: version.path })) ?? []),
        label: path,
        dirty: session.dirty,
        draftSession: session,
        captureContent: document.captureContent,
        save: async () => {
          if (!session.dirty.value) return { status: 'noop' as const };
          const saved = await session.saveDraft();
          return saved ? { status: 'saved' as const, receipt: saved.meta.receipt! } : { status: 'cancelled' as const };
        },
      },
    };
    const unregister = commands.registerSaveParticipant(participant);
    return {
      session,
      document,
      participant,
      problem: shallowRef<ErrorDiagnostic | null>(null),
      path: computed(() => session.currentTarget.value?.path ?? path),
      load: () => session.loadTarget({ ...owner, path }),
      save: () => commands.requestSave(participant),
      setText: document.replaceSource,
      undo: document.undo,
      redo: document.redo,
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
