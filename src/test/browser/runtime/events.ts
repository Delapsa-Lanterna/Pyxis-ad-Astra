type Listener = (event: { event: string; id: number; payload: unknown }) => void | Promise<void>;
const listeners = new Map<number, { event: string; handler: Listener; target?: string }>();
let sequence = 0;
export async function listen(event: string, handler: Listener, options?: { target?: string }) {
  const id = ++sequence;
  listeners.set(id, { event, handler, target: options?.target });
  return () => {
    listeners.delete(id);
  };
}
export async function emit(event: string, payload: unknown) {
  await Promise.all(
    [...listeners].filter(([, entry]) => entry.event === event).map(([id, entry]) => entry.handler({ event, id, payload })),
  );
}
export async function emitTo(target: string, event: string, payload: unknown) {
  await Promise.all(
    [...listeners]
      .filter(([, entry]) => entry.event === event && entry.target === target)
      .map(([id, entry]) => entry.handler({ event, id, payload })),
  );
}
export const eventListenerCount = () => listeners.size;
