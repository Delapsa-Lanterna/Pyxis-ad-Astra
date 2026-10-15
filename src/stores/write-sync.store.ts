import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CommittedWriteEvent, ErrorDiagnostic } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';
import { normalizeFsPath } from '@/shared/lib/paths';

export interface PendingWriteSync {
  id: string;
  event: CommittedWriteEvent;
  historyAccepted: boolean;
  step: 'projection' | 'acceptance' | 'broadcast';
  error: ErrorDiagnostic | null;
}

export const useWriteSyncStore = defineStore('write-sync', () => {
  const pending = ref<PendingWriteSync[]>([]);
  const completed = new Map<string, Set<number>>();
  const projections = new Map<string, { modRoot: string; revisions: Set<number> }>();

  function wasProjectionAccepted(sessionId: string, revision: number) {
    return projections.get(sessionId)?.revisions.has(revision) ?? false;
  }
  function markProjectionAccepted(modRoot: string, sessionId: string, revision: number) {
    let entry = projections.get(sessionId);
    if (!entry) {
      entry = { modRoot: normalizeFsPath(modRoot), revisions: new Set() };
      projections.set(sessionId, entry);
    }
    entry.revisions.add(revision);
  }

  function enqueue(event: CommittedWriteEvent) {
    const id = JSON.stringify([normalizeFsPath(event.modRoot), event.result.commitId]);
    const previous = pending.value.find((entry) => entry.id === id);
    if (previous) return previous;
    const entry: PendingWriteSync = { id, event: deepClone(event), historyAccepted: false, step: 'projection', error: null };
    pending.value.push(entry);
    return pending.value.find((entry) => entry.id === id)!;
  }
  function wasAccepted(event: Pick<CommittedWriteEvent, 'modRoot' | 'result'>) {
    return completed.get(normalizeFsPath(event.modRoot))?.has(event.result.commitId) ?? false;
  }
  function markAccepted(event: CommittedWriteEvent) {
    const root = normalizeFsPath(event.modRoot);
    if (!completed.has(root)) completed.set(root, new Set());
    completed.get(root)!.add(event.result.commitId);
  }
  function complete(id: string) {
    pending.value = pending.value.filter((entry) => entry.id !== id);
  }
  function removeModState(modRoot: string) {
    pending.value = pending.value.filter((entry) => normalizeFsPath(entry.event.modRoot) !== normalizeFsPath(modRoot));
    completed.delete(normalizeFsPath(modRoot));
    for (const [sessionId, entry] of projections) if (entry.modRoot === normalizeFsPath(modRoot)) projections.delete(sessionId);
  }
  function markFailed(id: string, error: ErrorDiagnostic) {
    const entry = pending.value.find((entry) => entry.id === id);
    if (entry) entry.error = error;
  }
  return {
    pending,
    enqueue,
    wasAccepted,
    markAccepted,
    complete,
    removeModState,
    markFailed,
    wasProjectionAccepted,
    markProjectionAccepted,
  };
});
