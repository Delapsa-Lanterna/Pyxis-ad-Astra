import { defineStore } from 'pinia';
import { computed, shallowReactive } from 'vue';
import type { CommittedWriteEvent, ErrorDiagnostic, SaveDelivery, SaveAcceptanceTask } from '@/shared/types';
import { normalizeFsPath } from '@/shared/lib/paths';

export interface PendingWriteSync {
  id: string;
  event: CommittedWriteEvent;
  tasks: SaveAcceptanceTask[];
  running: Promise<void> | null;
  error: ErrorDiagnostic | null;
}

interface PreparingSave {
  id: string;
  event: null;
  modRoot: string;
  sessionId: string | null;
  error: ErrorDiagnostic | null;
}

export const useProjectSyncStore = defineStore('project-sync', () => {
  const requests = shallowReactive(new Map<string, PendingWriteSync | PreparingSave>());
  const waitingRoots = shallowReactive(new Set<string>());
  const pending = computed(() => [...requests.values()].filter((work): work is PendingWriteSync => work.event !== null));
  const blocked = computed(() =>
    [...requests.values()]
      .filter((work) => work.error !== null)
      .map((work) => ({
        requestId: work.id,
        modRoot: work.event ? work.event.modRoot : work.modRoot,
        sessionId: work.event ? work.event.sessionId : work.sessionId,
        sessionIds: work.event ? work.event.result.sessionUpdates.map((update) => update.sessionId) : [],
        phase: work.event ? 'content' : 'preparing',
        diagnostic: work.error!,
      })),
  );
  function receive(entry: PendingWriteSync) {
    const owned = shallowReactive(entry);
    requests.set(entry.id, owned);
    return owned;
  }
  function isWaiting(modRoot: string | null | undefined) {
    return !!modRoot && waitingRoots.has(normalizeFsPath(modRoot));
  }
  function setWaiting(modRoot: string, waiting: boolean) {
    const root = normalizeFsPath(modRoot);
    if (waiting) {
      waitingRoots.add(root);
      for (const work of requests.values()) {
        const modRoot = work.event ? work.event.modRoot : work.modRoot;
        if (normalizeFsPath(modRoot) === root) work.error = null;
      }
    } else {
      waitingRoots.delete(root);
      for (const work of requests.values()) {
        const modRoot = work.event ? work.event.modRoot : work.modRoot;
        if (normalizeFsPath(modRoot) === root && work.event === null) requests.delete(work.id);
      }
    }
  }
  function setBlocked(delivery: Extract<SaveDelivery, { kind: 'blocked' }>) {
    waitingRoots.add(normalizeFsPath(delivery.modRoot));
    const work = requests.get(delivery.requestId);
    if (work) work.error = delivery.diagnostic;
    else
      requests.set(
        delivery.requestId,
        shallowReactive({
          id: delivery.requestId,
          event: null,
          modRoot: delivery.modRoot,
          sessionId: delivery.sessionId,
          error: delivery.diagnostic,
        }),
      );
  }
  function complete(id: string) {
    requests.delete(id);
  }
  function releaseWindow() {
    requests.clear();
    waitingRoots.clear();
  }
  function removeModState(modRoot: string, _sessionId: string | null) {
    void _sessionId;
    for (const work of requests.values()) {
      const root = work.event ? work.event.modRoot : work.modRoot;
      if (normalizeFsPath(root) === normalizeFsPath(modRoot)) complete(work.id);
    }
    setWaiting(modRoot, false);
  }
  return { pending, blocked, isWaiting, setWaiting, setBlocked, complete, releaseWindow, removeModState, receive };
});
