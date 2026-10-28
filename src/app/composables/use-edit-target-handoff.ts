import { watch, onScopeDispose } from 'vue';
import type { AppFeedback } from '@/shared/types';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { updateEditTargetRegistration } from '@/services/window.service';
import { deepClone } from '@/shared/lib/starsector';

export function useEditTargetHandoff(feedback: AppFeedback) {
  const commands = useSaveCommandStore();
  let registration = Promise.resolve();
  const stop = watch(
    () => [commands.editTargets, commands.closePrepared] as const,
    ([targets, prepared]) => {
      if (prepared) return;
      const captured = deepClone(targets);
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
