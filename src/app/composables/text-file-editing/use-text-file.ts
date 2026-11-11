import { computed, effectScope, shallowRef } from 'vue';
import { useTextFileState, type TextFileState } from './use-text-file-state';
import { readTextContent } from '@/shared/runtime/text-document';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { normalizeFsPath } from '@/shared/lib/paths';
import type { FileTextTarget, ErrorDiagnostic } from '@/shared/types';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';

export interface TextFileGroup {
  dirty: () => boolean;
  paths: () => string[];
  release: () => void;
  capture: () => () => boolean;
  save: () => Promise<DocumentSaveResult>;
  wait: () => Promise<boolean>;
  undo: () => boolean;
  redo: () => boolean;
  discard: () => void;
}

export function createTextFile(owner: Pick<FileTextTarget, 'sessionId' | 'modRoot'>, path: string, source?: string) {
  const readOnly = source !== undefined;
  const scope = effectScope();
  let released = false;
  const document = scope.run(() => {
    type Target = typeof owner & { path: string };
    const commands = useSaveCommandStore();
    const group = shallowRef<TextFileGroup | null>(null);
    const pendingPath = shallowRef<string | null>(null);
    const fileState: TextFileState<Target> = useTextFileState<Target>(
      {
        targetKey: (target) => `${target.sessionId}\n${normalizeFsPath(target.path)}`,
      },
      (target) => target?.path ?? path,
    );
    const { session, document } = fileState;
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
export type TextFile = ReturnType<typeof createTextFile>;
