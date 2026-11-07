import { observeSavedContent, sessionContentUpdate } from '@/orchestrators/project-sync.orchestrator';
import { openVariantImmersiveEditor } from '@/orchestrators/immersive-editor.orchestrator';
import { computed, onScopeDispose, ref, watch } from 'vue';
import { querySessionEntityEditTarget } from '@/services/entity-query.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { observeFieldSourceOptions } from '@/app/composables/field-editor/use-field-source-options';
import { querySourceOptionCatalog } from '@/services/source-catalog.service';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { queryBuiltInWeaponSlotOptions, hasHullReferencesInvalidation } from '@/services/hull-reference.service';

import { hasResourceInvalidation } from '@/services/resource-media.service';
import { queryFactionPreviewImages, queryMissionDraftIcon } from '@/services/json-entity.service';
import { jsonDocumentId, jsonDocumentContent } from '@/domain/json-editor/json-document-definitions';
import { AppError } from '@/shared/lib/errors';
import { isExternalSource } from '@/shared/lib/resource-ref';
import type { JsonDocumentSession } from './use-json-document-session';
import type { JsonEditorHost } from './json-editor-context';
import type { FieldEditorContext } from '@/domain/field-editor/field-editor-context';
import type { JsonDocumentDefinition } from '@/domain/json-editor/json-document-definitions';
import { composeJson, setCompositionValue } from '@/domain/json-composition';
import type { JsonValue } from '@/shared/types';

export function useJsonDocumentView(
  document: JsonDocumentSession,
  definition: JsonDocumentDefinition,
  locateBaseHull: JsonEditorHost['locateBaseHull'],
) {
  const feedback = useAppFeedback();
  const reads = useQueryReadOwner();
  const commands = useSaveCommandStore();
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });
  const previews = ref<Record<string, string>>(
    definition.kind === 'faction' ? { logoSrc: '', crestSrc: '' } : definition.kind === 'mission' ? { icon: '' } : {},
  );
  const revision = ref(0);
  const canNavigateBaseHull = computed(
    () => definition.kind === 'skin' && String(document.draftValue.value.baseHullId ?? '').trim().length > 0,
  );
  const partial = computed(() =>
    Boolean(document.composition.value && definition.kind !== 'variant' && !jsonDocumentId(definition, document.draftValue.value)),
  );
  const schemaRuntimeContext = computed<FieldEditorContext>(() => {
    const target = document.target.value!;
    if (definition.kind === 'misc-config') return { modRoot: target.modRoot, sessionId: target.sessionId, partial: true };
    const context = {
      modRoot: target.modRoot,
      sessionId: target.sessionId,
      partial: partial.value,
      composition: document.composition.value
        ? {
            local: () => document.draftValue.value,
            sources: () => {
              const sources = document.composition.value!;
              return definition.kind === 'skin' || definition.kind === 'variant'
                ? sources
                : { ...sources, layers: sources.layers.map((layer) => ({ ...layer, data: { file: layer.data } })) };
            },
            apply: (path: string[], value: JsonValue | undefined) => {
              document.draftValue.value = setCompositionValue(document.draftValue.value, path, value);
            },
            root: definition.kind === 'skin' || definition.kind === 'variant' ? [] : ['file'],
          }
        : undefined,
    };
    if (definition.kind === 'mission') return { ...context, missionId: target.id };
    if (definition.kind !== 'skin' && definition.kind !== 'variant') return context;
    const hullId = String(document.draftValue.value[definition.kind === 'variant' ? 'hullId' : 'baseHullId'] ?? '');
    return {
      ...context,
      sourceContextKey: hullId,
      querySourceOptions: (source, signal) =>
        source === 'hull:builtInWeaponSlots' || source === 'hull:weaponSlots' || source === 'hull:moduleSlots'
          ? hullId
            ? queryBuiltInWeaponSlotOptions(
                target.sessionId,
                hullId,
                signal,
                source === 'hull:moduleSlots' ? 'moduleSlots' : source === 'hull:weaponSlots' ? 'weaponSlots' : 'builtInWeaponSlots',
              )
            : Promise.resolve([])
          : querySourceOptionCatalog(target.sessionId, source, signal),
      subscribeSourceOptionInvalidation: (source, resources, listener) =>
        source === 'hull:builtInWeaponSlots' || source === 'hull:weaponSlots' || source === 'hull:moduleSlots'
          ? observeSavedContent((event) => {
              const update = sessionContentUpdate(event, target?.sessionId);
              if (!update) return;
              if (update.manifest.sessionId === target.sessionId && hasHullReferencesInvalidation(update.invalidation)) return listener();
            })
          : observeFieldSourceOptions(context, source, resources, listener),
    };
  });
  const previewContent = computed(() =>
    definition.kind === 'faction' || definition.kind === 'mission'
      ? composeJson(jsonDocumentContent(definition.kind, document.draftValue.value), document.composition.value)
      : {},
  );
  watch(
    [
      () => (definition.kind === 'faction' ? previewContent.value.logo : undefined),
      () => (definition.kind === 'faction' ? previewContent.value.crest : undefined),
      () => (definition.kind === 'mission' ? previewContent.value.icon : undefined),
      revision,
      document.active,
      document.targetKey,
    ],
    async () => {
      reads.revoke('consumer', 'previews');
      if (!document.active.value || (definition.kind !== 'faction' && definition.kind !== 'mission')) return;
      const target = document.target.value!;
      const draft =
        definition.kind === 'faction' ? previewContent.value : { ...document.draftValue.value, descriptor: previewContent.value };
      await reads.consume(
        'previews',
        target,
        async (signal) =>
          definition.kind === 'faction'
            ? queryFactionPreviewImages(target.sessionId, target.id, draft, signal)
            : { icon: await queryMissionDraftIcon(target.sessionId, target.id, draft, signal) },
        {
          ready: (images) => {
            previews.value = { ...images };
          },
          error: (error) => feedback.error(error, '刷新 JSON 预览失败'),
        },
      );
    },
    { immediate: true },
  );
  onScopeDispose(
    observeSavedContent((event) => {
      const update = sessionContentUpdate(event, document.target.value!.sessionId);
      if (!update) return;
      if (
        update.manifest.sessionId === document.target.value!.sessionId &&
        hasResourceInvalidation(update.invalidation, Object.values(document.record.value.resources))
      )
        revision.value++;
    }),
  );
  async function navigateToBaseHull() {
    if (!canNavigateBaseHull.value) return;
    const target = document.target.value!,
      admitted = document.inputs.captureContext(),
      targetKey = document.targetKey.value,
      sequence = commands.beginTransition();
    const current = () =>
      !disposed && document.active.value && document.targetKey.value === targetKey && admitted() && commands.isTransitionCurrent(sequence);
    try {
      const waiting = commands.waitForSaves();
      if ((waiting && !(await waiting)) || !current()) return;
      const committed = document.inputs.commit();
      if (committed && !(await committed)) return;
      if (!current()) return;
      const id = String(document.draftValue.value.baseHullId ?? '').trim();
      await reads.consume(
        'skin-hull-navigation',
        { target, id },
        (signal) => querySessionEntityEditTarget(target.sessionId, 'ship', id, signal),
        {
          ready: (snapshot) => {
            if (!current() || String(document.draftValue.value.baseHullId ?? '').trim() !== id) return;
            if (isExternalSource(snapshot.target.source?.source)) {
              feedback.info('船体「' + id + '」来自' + (snapshot.target.source?.source === 'core' ? '原版' : '其他 Mod') + '。');
              return;
            }
            if (snapshot.target.source?.source !== 'mod')
              throw new AppError('当前 Mod 没有船体记录「' + id + '」', { action: 'navigate-skin-hull' });
            const linked = snapshot.target.linkedRecord;
            if (!linked || linked.kind !== 'csv' || linked.table !== 'ships')
              throw new AppError('船体「' + id + '」缺少可定位的舰船表格行', { action: 'navigate-skin-hull' });
            locateBaseHull(target, { id, rowKey: linked.rowKey });
          },
          error: (error) => {
            if (current()) feedback.error(error, '跳转皮肤基础船体失败');
          },
        },
      );
    } catch (error) {
      if (current()) feedback.error(error, '跳转皮肤基础船体失败');
    }
  }
  async function openImmersive() {
    const target = document.target.value!;
    try {
      await openVariantImmersiveEditor(
        { sessionId: target.sessionId, modRoot: target.modRoot, kind: definition.file!.immersiveKind!, id: target.id },
        feedback,
      );
    } catch (error) {
      feedback.error(error, '打开' + definition.label + '沉浸式编辑器失败');
    }
  }
  return { canNavigateBaseHull, navigateToBaseHull, previews, schemaRuntimeContext, openImmersive };
}
