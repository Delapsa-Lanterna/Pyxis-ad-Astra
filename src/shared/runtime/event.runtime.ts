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
  return listen<T>(
    event,
    (message) => {
      void dispatchAppEvent(message.payload, handler).catch((error: unknown) => onError(error, event));
    },
    { target },
  );
}

async function dispatchAppEvent<T>(data: T, handler: AppEventHandler<T>): Promise<void> {
  await handler(data);
}
