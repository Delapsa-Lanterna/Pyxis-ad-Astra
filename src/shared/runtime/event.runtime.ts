import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type { UnlistenFn };

export type AppEventHandler<T> = (data: T) => void | Promise<void>;
export type AppEventErrorHandler = (error: unknown, event: string) => void;

export async function listenAppEvent<T>(
  event: string,
  handler: AppEventHandler<T>,
  onError: AppEventErrorHandler,
  target?: string,
): Promise<UnlistenFn> {
  let active = true;
  // Tauri owns native listener disposal once the page leaves; IPC is already unavailable then.
  const leave = () => {
    active = false;
  };
  window.addEventListener('pagehide', leave, { once: true, capture: true });
  let unlisten: UnlistenFn;
  try {
    unlisten = await listen<T>(
      event,
      (message) => {
        if (active)
          void dispatchAppEvent(message.payload, handler).catch((error: unknown) => {
            if (active) onError(error, event);
          });
      },
      { target },
    );
  } catch (error) {
    window.removeEventListener('pagehide', leave, true);
    throw error;
  }
  return () => {
    window.removeEventListener('pagehide', leave, true);
    if (active) {
      active = false;
      unlisten();
    }
  };
}

async function dispatchAppEvent<T>(data: T, handler: AppEventHandler<T>): Promise<void> {
  await handler(data);
}
