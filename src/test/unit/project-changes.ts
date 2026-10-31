import { afterEach } from 'vitest';
import type { CommittedWriteEvent, ProjectInvalidation, ProjectSessionInvalidationResult, WriteResult } from '@/shared/types';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/fixtures/write-result';
import { getActivePinia } from 'pinia';
import { useProjectStore } from '@/stores/project.store';
import type { SaveAcceptanceTask } from '@/shared/types';

export const projectChangeListeners = new Set<(event: CommittedWriteEvent) => ReturnType<SaveAcceptanceTask>>();
const releases = new Map<(event: CommittedWriteEvent) => ReturnType<SaveAcceptanceTask>, (sessionId: string) => void>();
export const savedContentWorks: Array<{ content: Promise<unknown>; retryContent: () => Promise<unknown> }> = [];
export function beginSavedWrite<T>(
  write: (request?: import('@/shared/runtime/command.runtime').SaveCommandRequest) => Promise<T>,
  accept: (value: Exclude<T, void | null>) => SaveAcceptanceTask[],
  complete?: (value: T) => unknown,
) {
  const written = write();
  let id = 'fixture-save';
  let tasks: SaveAcceptanceTask[] | undefined;
  const finish = async () => {
    const value = await written;
    if (value && typeof value === 'object' && 'requestId' in value && typeof value.requestId === 'string') id = value.requestId;
    if (value) {
      tasks ??= [
        ...accept(value as Exclude<T, void | null>),
        async () => {
          await complete?.(value);
        },
      ];
      while (tasks.length) {
        await run(tasks[0]!);
        tasks.shift();
      }
    }
    return value;
  };
  const content = finish();
  void content.catch(() => undefined);
  savedContentWorks.push({ content, retryContent: finish });
  return {
    get id() {
      return id;
    },
    result: written,
    content,
    retryContent: finish,
  };
}
export function withSavedCompletion(complete: (value: unknown) => unknown) {
  return <T>(write: Parameters<typeof beginSavedWrite<T>>[0], accept: Parameters<typeof beginSavedWrite<T>>[1]) =>
    beginSavedWrite(write, accept, complete);
}
export function observeSavedContentFixture(
  handler: (event: CommittedWriteEvent) => ReturnType<SaveAcceptanceTask>,
  release?: (sessionId: string) => void,
) {
  const receive: typeof handler = (event) => run(() => handler(event));
  projectChangeListeners.add(receive);
  if (release) releases.set(receive, release);
  return () => {
    projectChangeListeners.delete(receive);
    releases.delete(receive);
  };
}
async function run(task: SaveAcceptanceTask): Promise<void> {
  const result = await task();
  if (Array.isArray(result)) for (const child of result) await run(child);
}
export async function listenSavedContentFixture(
  handler: (event: CommittedWriteEvent) => void | Promise<void>,
  release?: (sessionId: string) => void,
) {
  return observeSavedContentFixture(handler, release);
}
export { observeSavedContentFixture as observeSavedContent, listenSavedContentFixture as listenSavedContent };
export function saveProjection(event: CommittedWriteEvent, sessionId: string | null | undefined) {
  const update = event.result.sessionUpdates.find((update) => update.sessionId === sessionId);
  return update?.projection ?? null;
}
export function projectChangeFixture(sessionId: string, invalidation: ProjectInvalidation, modRoot = 'M:/mod') {
  const manifest = getActivePinia() && [...useProjectStore().manifests.values()].find((manifest) => manifest.sessionId === sessionId);
  if (manifest) modRoot = manifest.modRoot;
  const projection = sessionUpdateFixture(sessionId, modRoot).projection;
  if (manifest) projection.manifest = manifest;
  return dispatchProjectChangeFixture({ kind: 'refresh', projection: { ...projection, invalidation } });
}
export function closeProjectChangeFixture(sessionId: string) {
  for (const release of releases.values()) release(sessionId);
}
export async function dispatchProjectChangeFixture(
  input: CommittedWriteEvent | { kind: 'refresh'; projection: ProjectSessionInvalidationResult },
) {
  let event: CommittedWriteEvent;
  if ('kind' in input) {
    const result = savedWriteFixture();
    result.sessionUpdates = [
      {
        sessionId: input.projection.manifest.sessionId,
        modRoot: input.projection.manifest.modRoot,

        projection: input.projection,
      },
    ];
    event = {
      result,
      sessionId: input.projection.manifest.sessionId,
      modRoot: input.projection.manifest.modRoot,
      originWindowLabel: 'peer',
      reason: 'refresh',
    };
  } else event = input;
  await Promise.all([...projectChangeListeners].map((handler) => handler(event)));
}
export function committedChangeFixture(result: WriteResult<unknown>, sessionId: string, modRoot: string): CommittedWriteEvent {
  const update = sessionUpdateFixture(sessionId, modRoot);
  update.projection.invalidation = result.invalidation;
  result.sessionUpdates = [update];
  return { sessionId, modRoot, result, reason: 'save', originWindowLabel: 'peer' };
}
afterEach(() => {
  savedContentWorks.length = 0;
  projectChangeListeners.clear();
  releases.clear();
});
