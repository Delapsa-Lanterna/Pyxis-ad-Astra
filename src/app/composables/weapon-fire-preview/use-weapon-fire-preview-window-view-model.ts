import { hasEntityInvalidation } from '@/services/entity-query.service';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import {
  refreshProjectSourcePaths,
  listenSavedIdentity,
  observeSavedContent,
  saveProjection,
} from '@/orchestrators/project-sync.orchestrator';
import { computed, ref, shallowRef, onScopeDispose } from 'vue';
import { useWindowContext } from '@/windows/window-context.window';
import { useManagedWindowRequests } from '@/app/composables/use-managed-window-requests';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { queryWeaponFirePreviewData } from '@/services/weapon-fire-preview.service';

import { retargetWeaponFirePreviewWindow } from '@/orchestrators/weapon-fire-preview.orchestrator';

import { hasResourceInvalidation } from '@/services/resource-media.service';
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
  const resourceRefs = computed(() => (data.value ? Object.values(data.value.resources).flatMap((group) => Object.values(group)) : []));
  const reads = useQueryReadOwner(),
    feedback = useAppFeedback();
  const stops: Array<() => void> = [];
  let disposed = false,
    identityPending = false;
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
        },
        error: (error) => {
          if (data.value) feedback.error(error, '刷新开火预览失败');
          else errorText.value = formatError(error);
          if (required) throw error;
        },
        settled: () => {
          loading.value = false;
        },
      },
    );
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
    const identityStop = await listenSavedIdentity(async (event) => {
      const before = target.value;
      if (event.sessionId !== before.sessionId || normalizeFsPath(event.modRoot) !== normalizeFsPath(before.modRoot)) return;
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
      } finally {
        identityPending = false;
        if (!disposed) await refresh(true);
      }
    });
    if (disposed) {
      identityStop();
      return;
    }
    stops.push(identityStop);
    stops.push(
      observeSavedContent(
        (event) => {
          if (
            event.result.identityChanges.some(
              (change) => change.before.kind === 'weapon' && change.before.id !== change.after.id && change.after.id === target.value.id,
            )
          )
            return undefined;
          const projection = saveProjection(event, target.value.sessionId);
          if (!projection) return undefined;
          if (projection.manifest.sessionId !== target.value.sessionId) return undefined;

          const projectileId = data.value?.weapon.projectileSpecId;
          if (
            hasEntityInvalidation(projection.invalidation, 'entity-detail', 'weapon', target.value.id) ||
            (typeof projectileId === 'string' &&
              hasEntityInvalidation(projection.invalidation, 'entity-detail', 'projectile', projectileId)) ||
            hasResourceInvalidation(projection.invalidation, resourceRefs.value)
          )
            return refresh(true);
          return undefined;
        },
        (sessionId) => {
          if (sessionId === target.value.sessionId) {
            reads.revoke('session');
            loading.value = false;
          }
        },
      ),
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
        resourceRefs.value,
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
