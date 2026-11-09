import { computed, effectScope, shallowRef } from 'vue';
import { useEditTargetDraftSession, type EditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { useSnapshotHistory } from '@/app/composables/use-snapshot-history';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useSettingsStore } from '@/stores/settings.store';
import { loadEditableFileData, writeEditableFileText } from '@/services/files.service';
import { beginSavedWrite } from '@/orchestrators/project-sync.orchestrator';
import { normalizeFsPath } from '@/shared/lib/paths';
import { emptyTextView } from '@/domain/code-editor/documents';
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
    const session: EditTargetDraftSession<string, Target, Meta> = useEditTargetDraftSession<string, Target, Meta>({
      emptyValue: '',
      clone: (text) => text,
      equals: (left, right) => left === right,
      targetKey: (target) => `${target.sessionId}\n${normalizeFsPath(target.path)}`,
      beginSave: beginSavedWrite,
      savedContent: (snapshot) => ({ ...snapshot, meta: { ...snapshot.meta, receipt: null } }),
      load: async (target, signal) => {
        const loaded = await waitForRead(loadEditableFileData(target.sessionId, target.modRoot, target.path), target, signal);
        signal!.throwIfAborted();
        return {
          target: { ...target, path: loaded.path },
          value: loaded.text,
          baseVersions: loaded.baseVersions,
          meta: { entity: loaded.entity, receipt: null },
        };
      },
      save: async (target, draft, versions, _original, request) => {
        const result = await writeEditableFileText(target.sessionId, target.modRoot, target.path, draft, versions, request);
        return {
          target,
          value: draft,
          baseVersions: result.baseVersions,
          requestId: result.requestId,
          meta: { entity: session.baselineSnapshot.value!.meta.entity, receipt: result },
        };
      },
    });
    const history = useSnapshotHistory(
      session.context,
      computed(() => settings.editHistoryLimit),
      (text: string) => text,
      (a, b) => a === b,
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
      surfaceText: computed(() => session.draftValue.value.replace(/\r\n|\r/g, '\n')),
      history,
      participant,
      view: emptyTextView(),
      problem: shallowRef<ErrorDiagnostic | null>(null),
      path: computed(() => session.currentTarget.value?.path ?? path),
      load: () => session.loadTarget({ ...owner, path }),
      save: () => commands.requestSave(participant),
      setText(text: string, before = session.draftValue.value) {
        if (text === before) return;
        history.push(before, text);
        if (text !== session.draftValue.value) session.setDraft(text);
      },
      undo() {
        const text = history.undo();
        if (text !== null) session.setDraft(text);
      },
      redo() {
        const text = history.redo();
        if (text !== null) session.setDraft(text);
      },
      dispose() {
        if (released) return;
        released = true;
        unregister();
        history.dispose();
        session.dispose();
        scope.stop();
      },
    };
  })!;
  return document;
}
export type CodeDocument = ReturnType<typeof createCodeDocument>;
