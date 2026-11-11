import { watch, onScopeDispose } from 'vue';
import type { AppFeedback } from '@/shared/types';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { updateEditTargetRegistration } from '@/services/window.service';
import { deepClone } from '@/shared/lib/starsector';

export function useEditTargetHandoff(feedback: AppFeedback) {
  const commands = useSaveCommandStore();
  let registration = Promise.resolve();
  const stop = watch(
    () => JSON.stringify([commands.editTargets, commands.closePrepared]),
    () => {
      if (commands.closePrepared) return;
      const captured = deepClone(commands.editTargets);
      registration = commands.trackCloseAction(
        registration.then(() => updateEditTargetRegistration(captured)).catch((error) => feedback.error(error, '登记编辑目标失败')),
      );
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    stop();
    void registration.then(() => updateEditTargetRegistration([])).catch((error) => feedback.error(error, '释放编辑目标失败'));
  });
}
