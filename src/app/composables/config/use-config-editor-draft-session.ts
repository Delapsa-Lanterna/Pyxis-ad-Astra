import { computed, onScopeDispose, type Ref } from 'vue';
import {
  useEditTargetDraftSession,
  type EditTargetDraftSession,
  type EditTargetDraftSessionOptions,
} from '@/app/composables/use-edit-target-draft-session';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useSaveCommandStore } from '@/stores/save-command.store';

type ConfigEditorDraftSessionOptions<TValue, TTarget, TMeta> = EditTargetDraftSessionOptions<TValue, TTarget, TMeta> & {
  modRoot: Readonly<Ref<string | null>>;
  receiptOf: (meta: TMeta) => import('@/shared/types').WriteResult<unknown> | null;
};

export function useConfigEditorDraftSession<TValue, TTarget extends { sessionId: string; modRoot: string }, TMeta = unknown>(
  options: ConfigEditorDraftSessionOptions<TValue, TTarget, TMeta>,
): EditTargetDraftSession<TValue, TTarget, TMeta> & { handoffLocked: Readonly<Ref<boolean>> } {
  const draftSession = useEditTargetDraftSession(options);
  const draftSessions = useDraftSessionsStore();
  const { confirmDiscard } = useFieldInputActions(draftSession.inputs);
  onScopeDispose(draftSessions.registerDraftSession(options.modRoot, draftSession.dirty));
  const commands = useSaveCommandStore();
  onScopeDispose(
    commands.registerSaveSession({
      targetKey: draftSession.currentTargetKey,
      modRoot: options.modRoot,
      saving: draftSession.saving,
      pendingSynchronization: draftSession.hasPendingSynchronization,
      waitForSave: draftSession.waitForSave,
      editing: {
        targets: computed(() => {
          const snapshot = draftSession.baselineSnapshot.value;
          return snapshot
            ? snapshot.baseVersions.map((version) => ({
                sessionId: snapshot.target.sessionId,
                modRoot: snapshot.target.modRoot,
                path: version.path,
              }))
            : [];
        }),
        label: '配置编辑器',
        dirty: draftSession.dirty,
        commitInputs: () => draftSession.inputs.commit(),
        save: async () => {
          const snapshot = await draftSession.saveDraft();
          return { saved: Boolean(snapshot), receipt: snapshot ? options.receiptOf(snapshot.meta) : null };
        },
      },
    }),
  );
  onScopeDispose(draftSession.dispose);
  return {
    ...draftSession,
    handoffLocked: computed(() => commands.isEditTargetLocked(draftSession.currentTargetKey.value)),
    loadPendingExternal: () => {
      const key = draftSession.currentTargetKey.value;
      const adopt = () => {
        if (key === draftSession.currentTargetKey.value)
          confirmDiscard(draftSession.loadPendingExternal, draftSession.dirty.value, () => draftSession.currentTargetKey.value);
      };
      const pending = commands.waitForSaves(options.modRoot.value, key);
      if (pending)
        void pending.then((saved) => {
          if (saved) adopt();
        });
      else adopt();
    },
  };
}
