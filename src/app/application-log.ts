import type { Pinia } from 'pinia';
import { beginDebug, appLogQueue, applicationLogError } from '@/shared/runtime/app-log-queue';
import { loadLogStatus } from '@/services/app-log.service';
import { errorMessageOf } from '@/shared/lib/errors';
import { listenWindowEvent } from '@/windows/tauri.events';
import { WINDOW_EVENTS } from '@/windows/window.events';

export async function startApplicationLog(pinia: Pinia): Promise<void> {
  const failed = (message: string) => {
    applicationLogError.value = message;
    appLogQueue.stop(message);
  };
  const stop = await listenWindowEvent<string>(WINDOW_EVENTS.appLogStopped, failed, (cause) => failed(errorMessageOf(cause)));
  window.addEventListener('pagehide', stop, { once: true });
  await loadLogStatus()
    .then((status) => {
      if (status.lastError) failed(status.lastError);
    })
    .catch((cause) => failed(errorMessageOf(cause)));
  pinia.use(({ store }) => {
    store.$onAction(({ name, after, onError }) => {
      const finish = beginDebug('store.action', () => ({ store: store.$id, action: name }));
      if (finish) {
        after(() => finish());
        onError(() => finish('failed'));
      }
    });
  });
}
