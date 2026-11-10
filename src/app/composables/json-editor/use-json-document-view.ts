import { computed, onScopeDispose, ref, watch } from 'vue';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { observeFieldSourceOptions } from '@/app/composables/field-editor/use-field-source-options';
import { querySourceOptionCatalog } from '@/services/source-catalog.service';
import { queryBuiltInWeaponSlotOptions, hasHullReferencesInvalidation } from '@/services/hull-reference.service';
import { querySessionEntityEditTarget } from '@/services/entity-query.service';
import { queryFactionPreviewImages, queryMissionDraftIcon } from '@/services/json-entity.service';
import { hasResourceInvalidation } from '@/services/resource-media.service';
import { observeSavedContent, sessionContentUpdate } from '@/orchestrators/project-sync.orchestrator';
import { openVariantImmersiveEditor } from '@/orchestrators/immersive-editor.orchestrator';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { composeJson, setCompositionValue } from '@/domain/json-composition';
import { jsonDocumentContent, jsonDocumentPartial, type JsonDocumentDefinition } from '@/domain/json-editor/json-document-definitions';
import { isExternalSource } from '@/shared/lib/resource-ref';
import { AppError } from '@/shared/lib/errors';
import type { FieldEditorContext } from '@/domain/field-editor/field-editor-context';
import type { JsonDocumentSession } from './use-json-document-session';
import type { JsonEditorHost } from './json-editor-context';

export function useJsonDocumentView(
  document: JsonDocumentSession,
  definition: JsonDocumentDefinition,
  locateBaseHull: JsonEditorHost['locateBaseHull'],
) {
  const feedback = useAppFeedback(() => ({ paths: document.record.value.baseVersions.map((version) => version.path) }));
  const reads = useQueryReadOwner(),
    commands = useSaveCommandStore(),
    revision = ref(0);
  const previews = ref<Record<string, string>>({});
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
  });
  const canNavigateBaseHull = computed(
    () => definition.kind === 'skin' && Boolean(String(document.draftValue.value.baseHullId ?? '').trim()),
  );
  const schemaRuntimeContext = computed<FieldEditorContext>(() => {
    void document.revision.value;
    const target = document.target.value!,
      kind = definition.kind;
    const context: FieldEditorContext = {
      sessionId: target.sessionId,
      modRoot: target.modRoot,
      document: document.document,
      partial: jsonDocumentPartial(definition, document.draftValue.value, document.composition.value),
      applyDocumentEdit: document.applyEdit,
      ...(kind !== 'misc-config' && document.composition.value
        ? {
            composition: {
              local: () => document.draftValue.value,
              sources: () => {
                const source = document.composition.value!;
                return kind === 'skin' || kind === 'variant'
                  ? source
                  : { ...source, layers: source.layers.map((layer) => ({ ...layer, data: { file: layer.data } })) };
              },
              apply: (path, value) => {
                document.draftValue.value = setCompositionValue(document.draftValue.value, path, value);
              },
              root: kind === 'variant' || kind === 'skin' ? [] : ['file'],
            },
          }
        : {}),
    };
    if (kind === 'mission') context.missionId = target.id;
    if (kind === 'skin' || kind === 'variant') {
      const hull = String(document.draftValue.value[kind === 'variant' ? 'hullId' : 'baseHullId'] ?? '');
      context.sourceContextKey = hull;
      context.querySourceOptions = (source, signal) =>
        ['hull:builtInWeaponSlots', 'hull:weaponSlots', 'hull:moduleSlots'].includes(source)
          ? hull
            ? queryBuiltInWeaponSlotOptions(
                target.sessionId,
                hull,
                signal,
                source === 'hull:moduleSlots' ? 'moduleSlots' : source === 'hull:weaponSlots' ? 'weaponSlots' : 'builtInWeaponSlots',
              )
            : Promise.resolve([])
          : querySourceOptionCatalog(target.sessionId, source, signal);
      context.subscribeSourceOptionInvalidation = (source, resources, listener) =>
        source.startsWith('hull:')
          ? observeSavedContent((event) => {
              const update = sessionContentUpdate(event, target.sessionId);
              if (update && hasHullReferencesInvalidation(update.invalidation)) return listener();
            })
          : observeFieldSourceOptions(context, source, resources, listener);
    }
    return context;
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
      if (!document.active.value || !['faction', 'mission'].includes(definition.kind)) return;
      const target = document.target.value!;
      await reads.consume(
        'previews',
        target,
        async (signal): Promise<Record<string, string>> =>
          definition.kind === 'faction'
            ? { ...(await queryFactionPreviewImages(target.sessionId, target.id, previewContent.value, signal)) }
            : {
                icon: await queryMissionDraftIcon(
                  target.sessionId,
                  target.id,
                  { ...document.draftValue.value, descriptor: previewContent.value },
                  signal,
                ),
              },
        {
          ready: (value) => {
            previews.value = { ...value };
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
      if (update && hasResourceInvalidation(update.invalidation, Object.values(document.record.value.resources))) revision.value++;
    }),
  );
  async function navigateToBaseHull() {
    const target = document.target.value!,
      admitted = document.inputs.captureContext(),
      key = document.targetKey.value;
    const sequence = commands.beginTransition();
    const current = () =>
      !disposed && document.active.value && document.targetKey.value === key && admitted() && commands.isTransitionCurrent(sequence);
    try {
      if (!canNavigateBaseHull.value) return;
      const waiting = commands.waitForSaves();
      if ((waiting && !(await waiting)) || !current()) return;
      const committed = document.inputs.commit();
      if ((committed && !(await committed)) || !current()) return;
      const id = String(document.draftValue.value.baseHullId).trim();
      await reads.consume('hull', { target, id }, (signal) => querySessionEntityEditTarget(target.sessionId, 'ship', id, signal), {
        ready: (snapshot) => {
          if (!current()) return;
          if (isExternalSource(snapshot.target.source?.source)) {
            feedback.info('船体 "' + id + '" 来自' + (snapshot.target.source?.source === 'core' ? '原版' : '其他 Mod') + '。', {
              paths: [target.modRoot, ...(snapshot.target.source ? [snapshot.target.source.path] : [])],
            });
            return;
          }
          const linked = snapshot.target.linkedRecord;
          if (!linked || linked.kind !== 'csv' || linked.table !== 'ships')
            throw new AppError('船体缺少可定位的舰船表格行', { action: 'navigate-skin-hull' });
          locateBaseHull(target, { id, rowKey: linked.rowKey });
        },
        error: (error) => {
          if (current()) feedback.error(error, '跳转皮肤基础船体失败');
        },
      });
    } catch (error) {
      if (current()) feedback.error(error, '跳转皮肤基础船体失败');
    }
  }
  async function openImmersive() {
    const target = document.target.value!;
    try {
      await openVariantImmersiveEditor({
        sessionId: target.sessionId,
        modRoot: target.modRoot,
        kind: definition.file!.immersiveKind!,
        id: target.id,
      });
    } catch (error) {
      feedback.error(error, '打开' + definition.label + '沉浸式编辑器失败');
    }
  }
  return { canNavigateBaseHull, navigateToBaseHull, previews, schemaRuntimeContext, openImmersive };
}
