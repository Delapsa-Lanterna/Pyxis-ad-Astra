import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { useJsonEditorStore } from '@/stores/json-editor.store';
import { completeJsonSave } from '@/orchestrators/json-save.orchestrator';
import { retryPendingModSyncs } from '@/orchestrators/project-sync.orchestrator';
import type { WriteResult } from '@/shared/types';
import { isReadInvalidated } from '@/shared/runtime/read-request';

interface ListHandoff {
  sessionId: string;
  modRoot: string;
  receipt: WriteResult;
  sourceId: string | null;
  changesTarget: boolean;
  accept: () => Promise<boolean>;
}

export function useJsonListSelection(options: {
  selectedId: Ref<string | null>;
  modRoot: Readonly<Ref<string | null>>;
  sessionId: Readonly<Ref<string | null>>;
  label: string;
  discard?: (id: string) => Promise<void>;
}) {
  const selectedId = options.selectedId;
  const deletedTarget = ref(false);
  const locked = ref(false);
  const writing = ref(false);
  const feedback = useAppFeedback();
  const commands = useSaveCommandStore();
  const jsonEditors = useJsonEditorStore();
  const sync = useProjectSyncStore();
  const handoff = shallowRef<ListHandoff | null>(null);
  let ids: string[] = [];
  let disposed = false;
  let operation: Promise<boolean> | null = null;
  let acceptance: Promise<void> | null = null;
  const key = computed(() => JSON.stringify([options.sessionId.value, options.modRoot.value]));
  const confirmations = new Set<(accepted: boolean) => void>();

  function hasDirtyTarget() {
    return jsonEditors.active?.target.value?.modRoot === options.modRoot.value && jsonEditors.active?.dirty.value;
  }

  function reconcile(nextIds: string[], preserveMissing = false) {
    ids = nextIds;
    if (selectedId.value && ids.includes(selectedId.value)) {
      deletedTarget.value = false;
      return;
    }
    if (selectedId.value && (preserveMissing || hasDirtyTarget() || locked.value || commands.hasPendingSave(options.modRoot.value))) {
      deletedTarget.value = true;
      return;
    }
    selectedId.value = ids[0] ?? null;
    deletedTarget.value = false;
  }

  async function prepare(): Promise<boolean> {
    if (writing.value) return false;
    const captured = key.value;
    const modRoot = options.modRoot.value!;
    const sequence = commands.beginTransition();
    const saving = commands.waitForSaves();
    if (saving && !(await saving)) return false;
    if (disposed || captured !== key.value || !commands.isTransitionCurrent(sequence)) return false;
    await retryPendingModSyncs(modRoot);
    await acceptHandoff();
    const committed = jsonEditors.active?.inputs.commit();
    if (committed && !(await committed)) return false;
    const capturedId = selectedId.value;
    const current = () => !disposed && captured === key.value && capturedId === selectedId.value && commands.isTransitionCurrent(sequence);
    if (!current()) return false;
    return current();
  }

  function confirmDiscard(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const finish = (accepted: boolean) => {
        confirmations.delete(finish);
        resolve(accepted);
      };
      confirmations.add(finish);
      feedback.confirmWarning({
        title: `交接${options.label}编辑？`,
        content: `当前${options.label}有未保存修改，确认放弃并继续？`,
        actionText: '放弃修改并继续',
        onConfirm: () => {
          finish(true);
        },
        onCancel: () => {
          finish(false);
        },
      });
    });
  }

  async function select(id: string | null) {
    if (id === selectedId.value && !deletedTarget.value) return;
    const captured = key.value;
    try {
      if (!(await prepare())) return;
      selectedId.value = id;
      deletedTarget.value = false;
    } catch (error) {
      if (!disposed && captured === key.value) feedback.error(error, `切换${options.label}失败`);
    }
  }

  function acceptHandoff(): Promise<void> {
    if (acceptance) return acceptance;
    const pending = handoff.value;
    if (!pending || disposed || pending.sessionId !== options.sessionId.value || pending.modRoot !== options.modRoot.value)
      return Promise.resolve();
    const event = { modRoot: pending.modRoot, result: pending.receipt };
    if (!sync.wasAccepted(event)) return Promise.resolve();
    acceptance = (async () => {
      locked.value = pending.changesTarget;
      const accepted = await pending.accept();
      if (accepted && handoff.value === pending) handoff.value = null;
    })().finally(() => {
      acceptance = null;
      if (!writing.value) {
        locked.value = false;
      }
    });
    return acceptance;
  }

  async function mutate(params: {
    sessionId: string;
    modRoot: string;
    changesTarget: boolean;
    label: string;
    write: () => Promise<WriteResult>;
    accept: () => Promise<boolean>;
  }): Promise<boolean> {
    if (disposed || params.sessionId !== options.sessionId.value || params.modRoot !== options.modRoot.value) return false;
    const current = () => !disposed && options.sessionId.value === params.sessionId && options.modRoot.value === params.modRoot;
    try {
      if (!(await prepare())) return false;
    } catch (error) {
      if (current()) feedback.error(error, `${params.label}失败`);
      return false;
    }
    locked.value = params.changesTarget;
    writing.value = true;
    const sourceId = selectedId.value;
    operation = (async () => {
      try {
        const receipt = await params.write();
        if (current())
          handoff.value = {
            sessionId: params.sessionId,
            modRoot: params.modRoot,
            receipt,
            sourceId,
            changesTarget: params.changesTarget,
            accept: params.accept,
          };
        await completeJsonSave(params.modRoot, params.sessionId, receipt, params.label);
        if (!current()) return false;
        await acceptHandoff();
        if (handoff.value) return false;
        feedback.success(params.label);
        return true;
      } catch (error) {
        await acceptHandoff();
        if (current() && !isReadInvalidated(error)) feedback.error(error, `${params.label}失败`);
        return false;
      } finally {
        locked.value = false;
        writing.value = false;
        operation = null;
      }
    })();
    return operation;
  }

  watch(
    () => sync.pending.map((entry) => [entry.id, entry.step, entry.error]),
    () => {
      void acceptHandoff().catch((error: unknown) => {
        if (!disposed) feedback.error(error, '更新配置列表失败');
      });
    },
  );
  watch(
    () => commands.hasPendingSave(options.modRoot.value),
    (saving) => {
      if (!saving && deletedTarget.value) reconcile(ids);
    },
  );
  watch(
    key,
    () => {
      confirmations.forEach((finish) => finish(false));
      ids = [];
      selectedId.value = null;
      deletedTarget.value = false;
      handoff.value = null;
      locked.value = false;
    },
    { flush: 'sync' },
  );
  onScopeDispose(
    commands.registerSaveSession({
      modRoot: options.modRoot,
      targetKey: computed(() => JSON.stringify([key.value, selectedId.value])),
      saving: writing,
      pendingSynchronization: computed(() => handoff.value !== null),
      waitForSave: async () => {
        if (operation) return operation;
        try {
          await retryPendingModSyncs(options.modRoot.value!);
          await acceptHandoff();
          return handoff.value === null;
        } catch (error) {
          feedback.error(error, '同步配置动作失败');
          return false;
        }
      },
    }),
  );
  onScopeDispose(() => {
    disposed = true;
    confirmations.forEach((finish) => finish(false));
    handoff.value = null;
  });

  return {
    selectedId,
    deletedTarget,
    locked,
    writing,
    reconcile,
    select,
    mutate,
    discardDeleted: async () => {
      const captured = key.value;
      const id = selectedId.value!;
      if ((await prepare()) && (await confirmDiscard()) && !disposed && captured === key.value && id === selectedId.value) {
        await options.discard?.(id);
        selectedId.value = ids[0] ?? null;
        deletedTarget.value = false;
      }
    },
  };
}
