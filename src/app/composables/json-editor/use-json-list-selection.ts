import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useJsonEditorStore } from '@/stores/json-editor.store';
import { beginSavedWrite } from '@/orchestrators/project-sync.orchestrator';
import { AppError } from '@/shared/lib/errors';
import { releaseNativeWindowTargets } from '@/services/window.service';
import type { SaveCommandRequest } from '@/shared/runtime/command.runtime';
import type { WriteResult } from '@/shared/types';
import { isReadInvalidated } from '@/shared/runtime/read-request';

export function useJsonListSelection(options: {
  selectedId: Ref<string | null>;
  modRoot: Readonly<Ref<string | null>>;
  sessionId: Readonly<Ref<string | null>>;
  label: string;
  discard?: (id: string) => Promise<boolean>;
}) {
  const selectedId = options.selectedId;
  const deletedTarget = ref(false);
  const locked = ref(false);
  const writing = ref(false);
  const selectionRequest = shallowRef<{ id: string | null; work: Promise<boolean> } | null>(null);
  const feedback = useAppFeedback();
  const commands = useSaveCommandStore();
  const jsonEditors = useJsonEditorStore();
  const currentRequestId = ref<string | null>(null);
  let ids: string[] = [];
  let disposed = false;
  let operation: Promise<boolean> | null = null;
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
    const sequence = commands.beginTransition();
    const saving = commands.waitForSaves();
    if (saving && !(await saving)) return false;
    if (disposed || captured !== key.value || !commands.isTransitionCurrent(sequence)) return false;
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
        title: '放弃当前编辑？',
        content: `${options.label} ${selectedId.value} 的来源已缺失。\n\n${jsonEditors.active?.target.value?.entity?.write.path ?? ''}\n\n继续后放弃当前草稿和输入，${ids.length ? '并转到下一条可用记录。' : '并结束这份文档的编辑。'}`,
        actionText: '放弃编辑并继续',
        onConfirm: () => {
          finish(true);
        },
        onCancel: () => {
          finish(false);
        },
        cancelText: '继续编辑',
      });
    });
  }

  async function discardTarget(id: string, confirm: boolean): Promise<boolean> {
    const captured = key.value;
    const current = () => !disposed && captured === key.value && id === selectedId.value;
    try {
      if (!current()) return false;
      if (!(await prepare())) {
        if (current()) feedback.info('当前编辑目标正在保存或交接，请稍后重试');
        return false;
      }
      if (!current() || (confirm && !(await confirmDiscard())) || !current()) return false;
      locked.value = true;
      try {
        if (options.discard && !(await options.discard(id))) return false;
        if (disposed || captured !== key.value) return false;
        selectedId.value = ids[0] ?? null;
        deletedTarget.value = false;
        return true;
      } finally {
        if (!disposed && captured === key.value) locked.value = false;
      }
    } catch (error) {
      if (current()) feedback.error(error, `放弃${options.label}编辑失败`);
      return false;
    }
  }

  async function select(id: string | null, accepts: () => boolean = () => true) {
    if (id === selectedId.value && !deletedTarget.value) {
      if (selectionRequest.value) commands.beginTransition();
      selectionRequest.value = null;
      return;
    }
    const captured = key.value;
    const request = { id, work: prepare() };
    selectionRequest.value = request;
    try {
      if (!(await request.work) || !accepts()) return;
      selectedId.value = id;
      deletedTarget.value = false;
    } catch (error) {
      if (!disposed && captured === key.value && selectionRequest.value === request && accepts())
        feedback.error(error, `切换${options.label}失败`);
    } finally {
      if (selectionRequest.value === request) selectionRequest.value = null;
    }
  }

  async function mutate(params: {
    sessionId: string;
    modRoot: string;
    changesTarget: boolean;
    label: string;
    write: (request: SaveCommandRequest) => Promise<WriteResult<unknown>>;
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
    operation = (async () => {
      try {
        const save = beginSavedWrite(params.write, () => [
          releaseNativeWindowTargets,
          async () => {
            if (current() && !(await params.accept())) throw new AppError('列表内容交接尚未完成', { code: 'write.content_incomplete' });
          },
        ]);
        currentRequestId.value = save.id;
        await save.result;
        if (!current()) return false;
        feedback.success(params.label);
        return true;
      } catch (error) {
        currentRequestId.value = null;
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
      currentRequestId.value = null;
      locked.value = false;
      selectionRequest.value = null;
    },
    { flush: 'sync' },
  );
  onScopeDispose(
    commands.registerSaveParticipant({
      modRoot: options.modRoot,
      targetKey: computed(() => JSON.stringify([key.value, selectedId.value])),
      saving: writing,
      waitForSave: async () => {
        if (operation) return operation;
        return true;
      },
    }),
  );
  onScopeDispose(() => {
    disposed = true;
    selectionRequest.value = null;
    confirmations.forEach((finish) => finish(false));
    currentRequestId.value = null;
  });

  return {
    selectingId: computed(() => selectionRequest.value?.id ?? null),
    selectedId,
    deletedTarget,
    locked,
    writing,
    isOwnSave: (id: string | undefined) => currentRequestId.value === id,
    reconcile,
    prepare,
    select,
    mutate,
    discardDeleted: async () => {
      await discardTarget(selectedId.value!, true);
    },
    discardMissing: async (id: string) => {
      const discarded = await discardTarget(id, false);
      if (discarded) feedback.success(`${options.label} "${id}" 已移除，源文件已不存在`);
      return discarded;
    },
  };
}
