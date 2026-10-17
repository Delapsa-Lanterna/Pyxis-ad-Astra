import { watch, onScopeDispose } from 'vue';
import type { AppFeedback } from '@/shared/types';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { listenEditTargetHandoff } from '@/orchestrators/edit-target-handoff.orchestrator';
import { updateEditTargetRegistration } from '@/services/window.service';
import { deepClone } from '@/shared/lib/starsector';

export function useEditTargetHandoff(feedback: AppFeedback) {
  const commands = useSaveCommandStore();
  let disposed = false;
  let stop: (() => void) | null = null;
  let registration = Promise.resolve();
  void listenEditTargetHandoff(feedback)
    .then((release) => {
      if (disposed) release();
      else stop = release;
    })
    .catch((error) => feedback.error(error, '启动编辑交接失败'));
  const stopWatch = watch(
    () => commands.editTargets,
    (targets) => {
      const captured = deepClone(targets);
      registration = registration
        .then(() => updateEditTargetRegistration(captured))
        .catch((error) => feedback.error(error, '登记编辑目标失败'));
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    disposed = true;
    stopWatch();
    stop?.();
    void registration.then(() => updateEditTargetRegistration([])).catch((error) => feedback.error(error, '释放编辑目标失败'));
  });
}
