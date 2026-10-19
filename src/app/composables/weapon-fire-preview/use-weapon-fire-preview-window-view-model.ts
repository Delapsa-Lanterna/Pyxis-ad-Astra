import { hasEntityInvalidation } from '@/services/entity-query.service';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import {
  refreshProjectSourcePaths,
  listenEntityIdentityApplied,
  listenProjectSessionInvalidated,
  invalidateProjectionCaches,
} from '@/orchestrators/project-sync.orchestrator';
import { computed, ref, shallowRef, onScopeDispose } from 'vue';
import { useWindowContext } from '@/windows/window-context.window';
import { useManagedWindowRequests } from '@/app/composables/use-managed-window-requests';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { queryWeaponFirePreviewData, queryWeaponFirePreviewImages } from '@/services/weapon-fire-preview.service';

import { retargetWeaponFirePreviewWindow } from '@/orchestrators/weapon-fire-preview.orchestrator';
import { subscribeQueryInvalidations } from '@/services/query-cache.service';
import { subscribeResourceInvalidations, hasResourceInvalidation } from '@/services/resource-media.service';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { normalizeFsPath } from '@/shared/lib/paths';
import { formatError } from '@/shared/lib/errors';
import type { WeaponFirePreviewSource, WeaponFirePreviewData, WindowContextFor } from '@/shared/types';
export function useWeaponFirePreviewWindowViewModel() {
  const initial = useWindowContext('weapon-fire-preview').value;
  const target = shallowRef(cloneQuerySnapshot<WindowContextFor<'weapon-fire-preview'>['identity']>(initial.identity));
  const source = shallowRef(cloneQuerySnapshot<WeaponFirePreviewSource>(initial.input.source));
  const data = shallowRef<WeaponFirePreviewData | null>(null),
    loading = ref(false),
    errorText = ref('');
  const reads = useQueryReadOwner(),
    feedback = useAppFeedback();
  const stops: Array<() => void> = [];
  let disposed = false,
    identityPending = false,
    identityCommit = -1;
  async function refresh(required = false) {
    if (disposed || identityPending) return;
    const captured = target.value;
    loading.value = true;
    errorText.value = '';
    await reads.consume(
      'data',
      { ...captured, source: source.value },
      (signal) => queryWeaponFirePreviewData(captured.sessionId, captured.id, source.value, signal),
      {
        ready: (next) => {
          data.value = next;
          void reads.consume(
            'images',
            { ...captured, refs: next.resourceRefs },
            (signal) => queryWeaponFirePreviewImages(captured.sessionId, next.resourceRefs, signal),
            {
              ready: (images) => {
                if (data.value === next) data.value = { ...next, weaponSpriteData: images };
              },
              error: (error) => feedback.error(error, '读取预览贴图失败'),
            },
          );
        },
        error: (error) => {
          if (data.value && !required) feedback.error(error, '刷新发射预览失败');
          else errorText.value = formatError(error);
          if (required) throw error;
        },
        settled: () => {
          loading.value = false;
        },
      },
    );
  }
  function scheduleRefresh() {
    reads.schedule('data', () => void refresh());
  }
  useManagedWindowRequests(async (request) => {
    if (request.kind !== 'weapon-fire-preview') return;
    reads.revoke();
    loading.value = false;
    target.value = cloneQuerySnapshot(request.identity);
    source.value = cloneQuerySnapshot(request.input.source);
    await ensureListeners();
    await refresh(true);
  });
  let initialization: Promise<void> | null = null;
  function ensureListeners() {
    return (initialization ??= install());
  }
  async function initialize() {
    await ensureListeners();
    await refresh();
  }
  async function install() {
    const identityStop = await listenEntityIdentityApplied(async (event) => {
      const before = target.value;
      if (
        event.sessionId !== before.sessionId ||
        normalizeFsPath(event.modRoot) !== normalizeFsPath(before.modRoot) ||
        event.result.commitId <= identityCommit
      )
        return;
      const change = event.result.identityChanges.find(
        (change) => change.before.kind === 'weapon' && change.before.id === before.id && change.after.id !== before.id,
      );
      if (!change) return;
      identityPending = true;
      reads.revoke();
      loading.value = false;
      try {
        await retargetWeaponFirePreviewWindow(before.sessionId, before.modRoot, change.after.id);
        if (disposed) return;
        target.value = { ...before, id: change.after.id };
        if (source.value.kind === 'draft') source.value = { kind: 'draft', weapon: { ...source.value.weapon, id: change.after.id } };
        identityCommit = event.result.commitId;
      } finally {
        identityPending = false;
        if (!disposed) scheduleRefresh();
      }
    });
    if (disposed) {
      identityStop();
      return;
    }
    stops.push(identityStop);
    const invalidationStop = await listenProjectSessionInvalidated((event) => {
      if (
        event.manifest.sessionId === target.value.sessionId &&
        normalizeFsPath(event.manifest.modRoot) === normalizeFsPath(target.value.modRoot)
      )
        invalidateProjectionCaches(event);
    });
    if (disposed) {
      invalidationStop();
      return;
    }
    stops.push(invalidationStop);
    stops.push(
      subscribeQueryInvalidations((event) => {
        if (event.sessionId !== target.value.sessionId) return;
        if (event.scope === 'session') {
          reads.revoke('session');
          loading.value = false;
          return;
        }
        const projectileId = data.value?.weapon.projectileSpecId;
        if (
          hasEntityInvalidation(event, 'entity-detail', 'weapon', target.value.id) ||
          (typeof projectileId === 'string' && hasEntityInvalidation(event, 'entity-detail', 'projectile', projectileId))
        )
          scheduleRefresh();
      }),
    );
    stops.push(
      subscribeResourceInvalidations((event) => {
        if (event.sessionId === target.value.sessionId && data.value && hasResourceInvalidation(event, data.value.resourceRefs))
          scheduleRefresh();
      }),
    );
  }
  useContextMenuScope({
    identity: () => JSON.stringify(target.value),
    canRefresh: () => Boolean(data.value),
    refresh: () =>
      refreshProjectSourcePaths(
        target.value.sessionId,
        target.value.modRoot,
        data.value!.baseVersions.map((version) => version.path),
        data.value!.resourceRefs,
      ),
  });
  function dispose() {
    disposed = true;
    reads.revoke();
    stops.splice(0).forEach((stop) => stop());
  }
  onScopeDispose(dispose);
  return {
    target: computed(() => target.value),
    source: computed(() => source.value),
    data: computed(() => data.value),
    loading,
    errorText,
    contentReady: computed(() => data.value !== null),
    initialize,
    dispose,
  };
}
