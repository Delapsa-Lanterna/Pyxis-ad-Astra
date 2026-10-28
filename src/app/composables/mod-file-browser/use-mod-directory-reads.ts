import { createReadTicket, isReadInvalidated } from '@/shared/runtime/read-request';
import type { ReadEndReason, ReadTicket } from '@/shared/runtime/read-request';
import type { ModDirectory } from '@/shared/types';

type Priority = 'foreground' | 'prefetch';
interface DirectoryIdentity {
  sessionId: string;
  directory: string | null;
}
interface DirectoryRead {
  identity: DirectoryIdentity;
  priority: Priority;
  promise: Promise<boolean>;
  resolve: (accepted: boolean) => void;
  ticket?: ReadTicket<ModDirectory, DirectoryIdentity>;
  error?: unknown;
}

export function createModDirectoryReads(handlers: {
  load: (identity: DirectoryIdentity) => Promise<ModDirectory>;
  started: (identity: DirectoryIdentity) => void;
  ready: (identity: DirectoryIdentity, result: ModDirectory) => void;
  error: (identity: DirectoryIdentity, error: unknown) => void;
  settled: (identity: DirectoryIdentity) => void;
}) {
  const tasks = new Map<string, DirectoryRead>();
  const queued = { foreground: new Map<string, DirectoryRead>(), prefetch: new Map<string, DirectoryRead>() };
  let active = 0,
    background = 0;
  const keyOf = (identity: DirectoryIdentity) => JSON.stringify([identity.sessionId, identity.directory]);

  function drain() {
    while (active < 3) {
      const next = queued.foreground.values().next().value ?? (background < 2 ? queued.prefetch.values().next().value : undefined);
      if (!next) return;
      queued[next.priority].delete(keyOf(next.identity));
      start(next);
    }
  }
  function start(task: DirectoryRead) {
    const key = keyOf(task.identity),
      prefetch = task.priority === 'prefetch';
    active++;
    if (prefetch) background++;
    handlers.started(task.identity);
    task.ticket = createReadTicket(task.identity, () =>
      handlers.load(task.identity).finally(() => {
        active--;
        if (prefetch) background--;
        drain();
      }),
    );
    let accepted = false;
    void task.ticket.promise
      .then((result) => {
        task.ticket!.accept();
        handlers.ready(task.identity, result);
        accepted = true;
      })
      .catch((error: unknown) => {
        if (!isReadInvalidated(error)) {
          task.error = error;
          handlers.error(task.identity, error);
        }
      })
      .finally(() => {
        if (tasks.get(key) === task) {
          tasks.delete(key);
          handlers.settled(task.identity);
        }
        task.resolve(accepted);
        drain();
      });
  }
  function wait(task: DirectoryRead, required: boolean) {
    return required
      ? task.promise.then((accepted) => {
          if (task.error) throw task.error;
          return accepted;
        })
      : task.promise;
  }
  function request(identity: DirectoryIdentity, priority: Priority = 'foreground', required = false) {
    const key = keyOf(identity),
      existing = tasks.get(key);
    if (existing) {
      if (priority === 'foreground' && existing.priority === 'prefetch') {
        if (queued.prefetch.delete(key)) queued.foreground.set(key, existing);
        existing.priority = priority;
      }
      drain();
      return wait(existing, required);
    }
    let resolve!: DirectoryRead['resolve'];
    const promise = new Promise<boolean>((finish) => {
      resolve = finish;
    });
    const task = { identity, priority, promise, resolve };
    tasks.set(key, task);
    queued[priority].set(key, task);
    drain();
    return wait(task, required);
  }
  function revoke(matches: (identity: DirectoryIdentity) => boolean = () => true, reason: ReadEndReason = 'consumer') {
    for (const [key, task] of tasks) {
      if (!matches(task.identity)) continue;
      tasks.delete(key);
      queued[task.priority].delete(key);
      task.ticket?.invalidate(reason);
      if (task.ticket) handlers.settled(task.identity);
      task.resolve(false);
    }
    drain();
  }
  return { request, revoke };
}
