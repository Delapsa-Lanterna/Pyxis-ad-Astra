import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { refreshProjectSourcePaths } from '@/orchestrators/project-session-refresh.orchestrator';
import { computed, ref, shallowRef, watch, onScopeDispose } from 'vue';
import type { JointEditRoot, ResourceRef, RowData } from '@/shared/types';
import { queryShipWeaponSources } from '@/services/editor.service';
import { hasQueryInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';
import { resourceCacheKey } from '@/services/resource-cache.service';
import { projectShipWeapons, type ShipWeaponSources } from '@/domain/editors/ship-weapons';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useEditorImages } from './use-editor-images';
import { formatError } from '@/shared/lib/errors';

export function useShipWeapons(root: () => JointEditRoot, ship: () => RowData, changed: () => void) {
  const sources = shallowRef<ShipWeaponSources>({ baseVersions: [], hints: [], weapons: {}, diagnostic: '' });
  const reads = useQueryReadOwner(),
    feedback = useAppFeedback();
  const mediaFailures = ref<readonly ResourceRef[]>([]),
    decodeFailures = ref<string[]>([]);
  useContextMenuScope({
    identity: () => JSON.stringify(root()),
    refresh: (current) =>
      refreshProjectSourcePaths(
        root().sessionId,
        root().modRoot,
        sources.value.baseVersions.map((version) => version.path),
        current,
        resources.value,
      ),
  });
  const projection = computed(() => projectShipWeapons(ship(), sources.value));
  const resources = computed<ResourceRef[]>((previous) => {
    const next = projection.value.weapons.flatMap((weapon) => [
      ...weapon.layers.map((layer) => layer.resource),
      ...(weapon.loadedMissile ? [weapon.loadedMissile.resource] : []),
    ]);
    return previous &&
      previous.length === next.length &&
      previous.every((resource, index) => resourceCacheKey(root().sessionId, resource) === resourceCacheKey(root().sessionId, next[index]!))
      ? previous
      : next;
  });
  const media = useResourceMediaRegistry({
    surface: '舰船内置武器',
    onError: (error) => feedback.error(error, '读取内置武器贴图失败'),
    onFailures: (items) => {
      mediaFailures.value = items;
    },
  });
  function load() {
    const target = { ...root() },
      draft = ship();
    sources.value = { baseVersions: [], hints: [], weapons: {}, diagnostic: '' };
    mediaFailures.value = [];
    void reads.consume(
      'weapons',
      { ...target, builtInWeapons: draft.builtInWeapons },
      (signal) => queryShipWeaponSources(target, draft, signal),
      {
        ready: (value) => {
          sources.value = value;
        },
        error: (error) => {
          sources.value = { baseVersions: [], hints: [], weapons: {}, diagnostic: formatError(error) };
        },
      },
    );
  }
  watch(() => JSON.stringify([root(), ship().builtInWeapons]), load, { immediate: true });
  onScopeDispose(
    subscribeQueryInvalidations((event) => {
      if (event.sessionId !== root().sessionId || !hasQueryInvalidation(event, 'joint-edit-candidate')) return;
      if (event.scope === 'session') {
        reads.revoke('session');
        sources.value = { baseVersions: [], hints: [], weapons: {}, diagnostic: '' };
        media.clear();
      } else reads.schedule('weapons', load);
    }),
  );
  watch(
    resources,
    (items) => {
      void media.replaceCollection(root().sessionId, 'weapons', items);
    },
    { immediate: true },
  );
  const imageSources = computed(() =>
    Object.fromEntries(
      resources.value.map((resource) => [resourceCacheKey(root().sessionId, resource), media.dataUrl(root().sessionId, resource) ?? '']),
    ),
  );
  watch(
    imageSources,
    () => {
      decodeFailures.value = [];
    },
    { flush: 'sync' },
  );
  const images = useEditorImages(
    () => imageSources.value,
    changed,
    (key) => {
      decodeFailures.value.push(key);
    },
  );
  const diagnostics = computed(() => [
    ...projection.value.diagnostics,
    ...projection.value.weapons.flatMap((weapon) => {
      const refs = [...weapon.layers.map((layer) => layer.resource), ...(weapon.loadedMissile ? [weapon.loadedMissile.resource] : [])];
      return refs.flatMap((resource) => {
        const key = resourceCacheKey(root().sessionId, resource);
        const missing =
          mediaFailures.value.some((failure) => resourceCacheKey(root().sessionId, failure) === key) &&
          !media.dataUrl(root().sessionId, resource);
        return missing || decodeFailures.value.includes(key)
          ? [`槽位 ${String(weapon.slot.id)} · 武器 ${weapon.weaponId}：${resource.relPath} ${missing ? '贴图读取失败' : '贴图解码失败'}`]
          : [];
      });
    }),
  ]);
  watch(projection, changed, { flush: 'post' });
  return {
    weapons: computed(() => projection.value.weapons),
    diagnostics,
    image: (resource: ResourceRef) => images.images.get(resourceCacheKey(root().sessionId, resource)),
  };
}
