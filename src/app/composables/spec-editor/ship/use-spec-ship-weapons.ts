import { hasJointEditInvalidation } from '@/services/joint-edit.service';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { refreshProjectSourcePaths, observeSavedContent, saveProjection } from '@/orchestrators/project-sync.orchestrator';
import { computed, ref, shallowRef, watch, onScopeDispose } from 'vue';
import type { JointEditRoot, ResourceRef, RowData } from '@/shared/types/index';
import { querySpecShipWeaponSources } from '@/services/spec-ship-editor.service';

import { mediaResourceKey } from '@/services/resource-media.service';
import { projectShipWeapons, type ShipWeaponSources } from '@/domain/spec-editor/ship/spec-ship-weapons';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useEditorImages } from '../../editors/use-editor-images';
import { formatError } from '@/shared/lib/errors';

export function useSpecShipWeapons(root: () => JointEditRoot, ship: () => RowData, changed: () => void) {
  const sources = shallowRef<ShipWeaponSources>({ baseVersions: [], hints: [], weapons: {}, diagnostic: '' });
  const reads = useQueryReadOwner(),
    feedback = useAppFeedback();
  const mediaFailures = ref<readonly ResourceRef[]>([]),
    decodeFailures = ref<string[]>([]);
  useContextMenuScope({
    identity: () => JSON.stringify(root()),
    refresh: () =>
      refreshProjectSourcePaths(
        root().sessionId,
        root().modRoot,
        sources.value.baseVersions.map((version) => version.path),
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
      previous.every((resource, index) => mediaResourceKey(root().sessionId, resource) === mediaResourceKey(root().sessionId, next[index]!))
      ? previous
      : next;
  });
  const media = useResourceMediaRegistry({
    onError: (error) => feedback.error(error, '读取内置武器贴图失败'),
    onFailures: (items) => {
      mediaFailures.value = items;
    },
  });
  function load(required = false) {
    const target = { ...root() },
      draft = ship();
    sources.value = { baseVersions: [], hints: [], weapons: {}, diagnostic: '' };
    mediaFailures.value = [];
    return reads.consume(
      'weapons',
      { ...target, builtInWeapons: draft.builtInWeapons },
      (signal) => querySpecShipWeaponSources(target, draft, signal),
      {
        ready: (value) => {
          sources.value = value;
        },
        error: (error) => {
          sources.value = { baseVersions: [], hints: [], weapons: {}, diagnostic: formatError(error) };

          if (required) throw error;
        },
      },
    );
  }
  watch(
    () => JSON.stringify([root(), ship().builtInWeapons]),
    () => {
      void load();
    },
    { immediate: true },
  );
  onScopeDispose(
    observeSavedContent(
      (event) => {
        const projection = saveProjection(event, root().sessionId);
        if (!projection) return;
        if (projection.manifest.sessionId !== root().sessionId || !hasJointEditInvalidation(projection.invalidation)) return;
        return load(true);
      },
      (sessionId) => {
        if (sessionId !== root().sessionId) return;
        reads.revoke('session');
        sources.value = { baseVersions: [], hints: [], weapons: {}, diagnostic: '' };
        media.clear();
      },
    ),
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
      resources.value.map((resource) => [mediaResourceKey(root().sessionId, resource), media.dataUrl(root().sessionId, resource) ?? '']),
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
        const key = mediaResourceKey(root().sessionId, resource);
        const missing =
          mediaFailures.value.some((failure) => mediaResourceKey(root().sessionId, failure) === key) &&
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
    hints: computed(() => sources.value.hints),
    diagnostics,
    image: (resource: ResourceRef) => images.images.get(mediaResourceKey(root().sessionId, resource)),
  };
}
