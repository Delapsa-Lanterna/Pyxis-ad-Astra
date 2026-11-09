import { observeSavedContent, sessionContentUpdate } from '@/orchestrators/project-sync.orchestrator';
import { computed, shallowRef, ref, watch, onScopeDispose } from 'vue';
import type { JointEditRoot, JointEditSnapshot, ResourceRef } from '@/shared/types';
import { queryJointCandidate, hasJointEditInvalidation } from '@/services/joint-edit.service';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { projectWeaponPanel } from '@/domain/immersive/weapon/weapon-panel';
import { projectWingPanel } from '@/domain/immersive/wing/wing-panel';
import { projectShipPanel } from '@/domain/immersive/ship/ship-panel';
import { projectVariantPanel } from '@/domain/immersive/variant/variant-panel';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { formatError, warningNotice } from '@/shared/lib/errors';

export async function readModuleCandidateIssue(root: JointEditRoot, id: string, signal: AbortSignal) {
  const candidate = await queryJointCandidate({ ...root, kind: 'variant', id }, signal);
  const record = candidate.records.find(
    (record) => record.target.kind === 'spec' && record.target.target.kind === 'variant' && record.target.target.id === id,
  );
  return {
    reason: !candidate.hull ? '找不到此装配或其船体的来源。' : candidate.hull.hints.includes('MODULE') ? '' : '此船体没有 MODULE 标记。',
    source: record?.source?.path ?? '来源缺失',
  };
}
export function useVariantCandidate(root: () => JointEditRoot, kind: () => 'weapons' | 'wings' | 'variants', id: () => string) {
  const snapshot = shallowRef<JointEditSnapshot | null>(null),
    errorText = ref(''),
    reads = useQueryReadOwner(),
    feedback = useAppFeedback();
  const values = computed(() => Object.fromEntries(snapshot.value?.records.map((record) => [record.key, record.value]) ?? []));
  const panel = computed(() =>
    snapshot.value
      ? kind() === 'variants'
        ? snapshot.value.hull
          ? projectShipPanel(snapshot.value, values.value, snapshot.value, projectVariantPanel(snapshot.value, values.value).variants[0])
          : null
        : kind() === 'weapons'
          ? projectWeaponPanel(snapshot.value, values.value)
          : projectWingPanel(snapshot.value, values.value)
      : null,
  );
  const stats = computed(() =>
    panel.value?.kind === 'weapon'
      ? [...panel.value.primary, ...panel.value.ancillary]
      : panel.value?.kind === 'wing'
        ? panel.value.technical
        : (panel.value?.combat ?? []),
  );
  const media = useResourceMediaRegistry({
    onError: (error, context) => feedback.error(error, undefined, context),
    onFailures: (items, context) => {
      const missing = items.filter((resource) => resource.ownerId !== 'damage-type');
      if (missing.length)
        feedback.warning(warningNotice('候选资源缺失：' + missing.length, 'resource.not_found', JSON.stringify(missing)), context);
    },
  });
  const mediaUrl = (resource: ResourceRef | null | undefined) => media.dataUrl(root().sessionId, resource) ?? '';
  function load(required = false) {
    snapshot.value = null;
    errorText.value = '';
    media.clear();
    if (!id()) {
      reads.revoke();
      return;
    }
    const target: JointEditRoot = { ...root(), kind: kind() === 'weapons' ? 'weapon' : kind() === 'wings' ? 'wing' : 'variant', id: id() };
    return reads.consume('detail', target, (signal) => queryJointCandidate(target, signal), {
      ready: (value) => {
        snapshot.value = cloneQuerySnapshot<JointEditSnapshot>(value);
      },
      error: (error) => {
        errorText.value = formatError(error);

        if (required) throw error;
      },
    });
  }
  watch(
    () => [id(), kind(), root()],
    () => {
      void load();
    },
    { immediate: true },
  );
  onScopeDispose(
    observeSavedContent(
      (event) => {
        const update = sessionContentUpdate(event, root().sessionId);
        if (!update) return undefined;
        if (update.manifest.sessionId !== root().sessionId || !hasJointEditInvalidation(update.invalidation)) return undefined;
        if (id()) return load(true);
        return undefined;
      },
      (sessionId) => {
        if (sessionId !== root().sessionId) return;
        reads.revoke('session');
        snapshot.value = null;
        media.clear();
      },
    ),
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
