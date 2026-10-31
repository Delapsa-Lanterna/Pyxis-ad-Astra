import type { Pinia } from 'pinia';
import { beginDebug, appLogQueue, applicationLogError } from '@/shared/runtime/app-log-queue';
import { listenLogStopped, loadLogStatus } from '@/services/app-log.service';
import { errorMessageOf } from '@/shared/lib/errors';

export async function startApplicationLog(pinia: Pinia): Promise<void> {
  let active = true;
  let stop: (() => void) | null = null;
  const release = () => {
    active = false;
    stop?.();
    stop = null;
    window.removeEventListener('pagehide', release);
  };
  window.addEventListener('pagehide', release, { once: true });
  const failed = (message: string) => {
    if (!active) return;
    applicationLogError.value = message;
    appLogQueue.stop(message);
  };
  try {
    stop = await listenLogStopped(failed, (cause) => failed(errorMessageOf(cause)));
    if (!active) return release();
    await loadLogStatus()
      .then((status) => {
        if (status.lastError) failed(status.lastError);
      })
      .catch((cause) => failed(errorMessageOf(cause)));
    if (!active) return release();
    pinia.use(({ store }) => {
      store.$onAction(({ name, after, onError }) => {
        const finish = beginDebug('store.action', () => ({ store: store.$id, action: name }));
        if (finish) {
          after(() => finish());
          onError(() => finish('failed'));
        }
      });
    });
  } catch (error) {
    release();
    throw error;
  }
}
