import { afterEach } from 'vitest';
import type { ProjectChange, ProjectInvalidation, WriteResult } from '@/shared/types';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { getActivePinia } from 'pinia';
import { useProjectStore } from '@/stores/project.store';

export const projectChangeListeners = new Set<(change: ProjectChange) => void>();
let revision = 0;
export function subscribeProjectChangesFixture(handler: (change: ProjectChange) => void) {
  projectChangeListeners.add(handler);
  return () => {
    projectChangeListeners.delete(handler);
  };
}
export async function listenProjectChangesFixture(handler: (change: ProjectChange) => void) {
  return subscribeProjectChangesFixture(handler);
}
export { subscribeProjectChangesFixture as subscribeProjectChanges, listenProjectChangesFixture as listenProjectChanges };
export const projectChangeSessionId = (change: ProjectChange) =>
  change.kind === 'closed' ? change.sessionId : change.projection.manifest.sessionId;
export function projectChangeFixture(sessionId: string, invalidation: ProjectInvalidation, modRoot = 'M:/mod') {
  const manifest = getActivePinia() && [...useProjectStore().manifests.values()].find((manifest) => manifest.sessionId === sessionId);
  if (manifest) modRoot = manifest.modRoot;
  const projection = sessionUpdateFixture(sessionId, modRoot, ++revision).projection;
  if (manifest) projection.manifest = manifest;
  dispatchProjectChangeFixture({ kind: 'refresh', projection: { ...projection, invalidation } });
}
export function closeProjectChangeFixture(sessionId: string) {
  dispatchProjectChangeFixture({ kind: 'closed', sessionId });
}
export function dispatchProjectChangeFixture(change: ProjectChange) {
  for (const handler of projectChangeListeners) handler(change);
}
export function committedChangeFixture(result: WriteResult<unknown>, sessionId: string, modRoot: string): ProjectChange {
  const projection = sessionUpdateFixture(sessionId, modRoot, result.commitId).projection;
  projection.invalidation = result.invalidation;
  return {
    kind: 'commit',
    projection,
    event: { sessionId, modRoot, result, reason: 'save', originWindowLabel: 'peer' },
  };
}
afterEach(() => projectChangeListeners.clear());
