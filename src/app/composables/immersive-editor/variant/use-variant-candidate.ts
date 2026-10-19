import { computed, shallowRef, ref, watch, onScopeDispose } from 'vue';
import type { JointEditRoot, JointEditSnapshot, ResourceRef } from '@/shared/types';
import { queryJointCandidate } from '@/services/joint-edit.service';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { projectWeaponPanel } from '@/domain/immersive/weapon/weapon-panel';
import { projectWingPanel } from '@/domain/immersive/wing/wing-panel';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { formatError, warningNotice } from '@/shared/lib/errors';
import { hasQueryInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';
export function useVariantCandidate(root: () => JointEditRoot, kind: () => 'weapons' | 'wings', id: () => string) {
  const snapshot = shallowRef<JointEditSnapshot | null>(null),
    errorText = ref(''),
    reads = useQueryReadOwner(),
    feedback = useAppFeedback();
  const values = computed(() => Object.fromEntries(snapshot.value?.records.map((record) => [record.key, record.value]) ?? []));
  const panel = computed(() =>
    snapshot.value
      ? kind() === 'weapons'
        ? projectWeaponPanel(snapshot.value, values.value)
        : projectWingPanel(snapshot.value, values.value)
      : null,
  );
  const stats = computed(() =>
    panel.value?.kind === 'weapon' ? [...panel.value.primary, ...panel.value.ancillary] : (panel.value?.technical ?? []),
  );
  const media = useResourceMediaRegistry({
    onError: (error) => feedback.error(error),
    onFailures: (items) => {
      const missing = items.filter((resource) => resource.ownerId !== 'damage-type');
      if (missing.length)
        feedback.warning(warningNotice('候选资源缺失：' + missing.length, 'resource.read_failed', 'Variant detail media'));
    },
  });
  const mediaUrl = (resource: ResourceRef | null | undefined) => media.dataUrl(root().sessionId, resource) ?? '';
  function load() {
    snapshot.value = null;
    errorText.value = '';
    media.clear();
    if (!id()) {
      reads.revoke();
      return;
    }
    const target: JointEditRoot = { ...root(), kind: kind() === 'weapons' ? 'weapon' : 'wing', id: id() };
    void reads.consume('detail', target, (signal) => queryJointCandidate(target, signal), {
      ready: (value) => {
        snapshot.value = cloneQuerySnapshot<JointEditSnapshot>(value);
      },
      error: (error) => {
        errorText.value = formatError(error);
      },
    });
  }
  watch(() => [id(), kind(), root()], load, { immediate: true });
  onScopeDispose(
    subscribeQueryInvalidations((event) => {
      if (event.sessionId !== root().sessionId || !hasQueryInvalidation(event, 'joint-edit-candidate')) return;
      if (event.scope === 'session') {
        reads.revoke('session');
        snapshot.value = null;
        media.clear();
      } else if (id()) reads.schedule('detail', load);
    }),
  );
  watch(panel, (value) => {
    void media.replaceCollection(
      root().sessionId,
      'detail',
      value?.kind === 'weapon'
        ? [
            ...value.iconLayers.map((layer) => layer.resource),
            ...(value.loadedMissile ? [value.loadedMissile.resource] : []),
            ...(value.damageIcon ? [value.damageIcon] : []),
          ]
        : value?.sprite
          ? [value.sprite]
          : [],
    );
  });
  return { snapshot, errorText, values, panel, stats, mediaUrl };
}
