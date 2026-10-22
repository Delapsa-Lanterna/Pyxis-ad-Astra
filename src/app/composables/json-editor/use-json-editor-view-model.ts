import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { JsonEditorContext } from './json-editor-context';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { useJsonDocumentSession, type JsonDocumentSession } from './use-json-document-session';
import { useJsonListSelection } from './use-json-list-selection';
import { jsonDocumentCapabilities } from './json-document-capabilities';
import { useJsonEditorStore, type JsonDocumentState } from '@/stores/json-editor.store';
import { useSettingsStore } from '@/stores/settings.store';
import {
  jsonDocumentRecord,
  jsonDocumentMedia,
  jsonDocumentSummary,
  jsonDocumentValue,
  type JsonDocumentDefinition,
  type JsonDocumentRecord,
} from '@/domain/json-editor/json-document-definitions';
import { querySessionEntityList, hasEntityInvalidation } from '@/services/entity-query.service';
import { queryHullReferenceOptions, querySessionHullReferences } from '@/services/hull-reference.service';
import { subscribeQueryInvalidations } from '@/services/query-cache.service';
import { refreshProjectSourcePaths } from '@/orchestrators/project-sync.orchestrator';
import { focusExistingEntityWindow } from '@/orchestrators/window-target-focus.orchestrator';
import { warningNotice } from '@/shared/lib/errors';
import { startPerformance } from '@/shared/runtime/performance';
import type { SelectOption } from '@/domain/schema/schema-options';

export function useJsonEditorViewModel(definition: JsonDocumentDefinition, context: JsonEditorContext) {
  const feedback = useAppFeedback();
  const editors = useJsonEditorStore();
  const settings = useSettingsStore();
  const reads = useQueryReadOwner();
  const capabilities = jsonDocumentCapabilities(definition, feedback);
  const { kind } = definition;
  const { modRoot, sessionId, active } = context;
  const formal = shallowRef<Array<{ record: JsonDocumentRecord; document: JsonDocumentState | null }>>([]);
  const hullNames = ref<Record<string, string>>({});
  const hullOptions = shallowRef<SelectOption[]>([]);
  const listLoadStartedAt = ref(0);
  const current = shallowRef<JsonDocumentSession | null>(null);
  const selectedId = editors.selection(sessionId.value!, kind);
  const selection = useJsonListSelection({
    selectedId,
    modRoot,
    sessionId,
    label: definition.label,
    discard: async (id) => {
      editors.releaseEntity(sessionId.value!, kind, id);
      await load();
    },
  });
  const documents = computed(() => editors.documentStates(sessionId.value!).filter((document) => document.target.value?.kind === kind));
  function bindRecord(record: JsonDocumentRecord) {
    return { record, document: documents.value.find((document) => document.sourceTarget.value.id === record.target.id) ?? null };
  }
  function boundDocument(entry: (typeof formal.value)[number]) {
    return entry.document && documents.value.includes(entry.document) ? entry.document : bindRecord(entry.record).document;
  }
  const records = computed(() => [
    ...formal.value.map((entry) => boundDocument(entry)?.record.value ?? entry.record),
    ...documents.value
      .filter((document) => !formal.value.some((entry) => boundDocument(entry) === document))
      .map((document) => document.record.value),
  ]);
  const items = computed(() => {
    const rows = records.value.map((record) => {
      const document = documents.value.find((document) => document.target.value!.id === record.target.id);
      return {
        record,
        key: record.target.id,
        ...jsonDocumentSummary(definition, record, document?.draftValue.value, hullNames.value),
        dirty: document?.dirty.value ?? false,
        missing: document?.sourceMissing.value ?? false,
        resource: jsonDocumentMedia(record),
      };
    });
    return kind === 'mission' || kind === 'mod-info'
      ? rows
      : rows.sort((a, b) => a.companion.localeCompare(b.companion) || a.key.localeCompare(b.key));
  });
  async function load() {
    listLoadStartedAt.value = startPerformance();
    if (kind === 'mod-info') {
      const manifest = context.manifest.value!;
      formal.value = [
        bindRecord({
          target: { sessionId: manifest.sessionId, modRoot: manifest.modRoot, kind, id: 'mod-info', entity: null },
          value: jsonDocumentValue(kind, manifest.modInfo ?? {}),
          baseVersions: manifest.baseVersions,
          resources: {},
        }),
      ];
    } else {
      const accepted = await reads.consume(
        'list',
        { sessionId: sessionId.value!, kind },
        (signal) => querySessionEntityList(sessionId.value!, kind, signal),
        {
          ready: (entities) => {
            formal.value = entities.map((entity) => bindRecord(jsonDocumentRecord(sessionId.value!, modRoot.value!, entity)));
          },
          error: (error) => feedback.error(error, '加载' + definition.label + '失败'),
        },
      );
      if (!accepted) return false;
    }
    selection.reconcile(
      items.value.map((item) => item.key),
      Boolean(selectedId.value && documents.value.some((document) => document.target.value!.id === selectedId.value)),
    );
    if (definition.file?.usesHullNames) {
      const hullIds = items.value.map((item) => item.companion);
      await reads.consume('names', hullIds, (signal) => querySessionHullReferences(sessionId.value!, hullIds, signal), {
        ready: (names) => {
          hullNames.value = names.hullNames;
        },
        error: (error) => feedback.error(error, '读取舰体名称失败'),
      });
    }
    return true;
  }
  async function loadHullOptions() {
    if (!definition.file || settings.isPlainEditMode) return;
    await reads.consume('options', { sessionId: sessionId.value! }, (signal) => queryHullReferenceOptions(sessionId.value!, [], signal), {
      ready: (options) => {
        hullOptions.value = options;
      },
      error: (error) => feedback.error(error, '读取舰体引用失败'),
    });
  }
  async function create(id: string, companion: string) {
    if (items.value.some((item) => item.key === id)) {
      await focusExistingEntityWindow(sessionId.value!, modRoot.value!, kind as 'faction' | 'mission' | 'variant' | 'skin', id);
      feedback.warning(warningNotice(definition.label + ' "' + id + '" 已存在', 'config.entity_exists', 'JSON entity ID exists: ' + id));
      return false;
    }
    const target = { sessionId: sessionId.value!, modRoot: modRoot.value!, kind, id, entity: null };
    return selection.mutate({
      sessionId: target.sessionId,
      modRoot: target.modRoot,
      changesTarget: true,
      label: definition.label + ' "' + id + '" 已创建',
      write: () => capabilities.create(target, id, companion),
      accept: async () => {
        if (!(await load())) return false;
        selectedId.value = id;
        return true;
      },
    });
  }
  async function remove(record: JsonDocumentRecord, deleteSource: boolean) {
    return selection.mutate({
      sessionId: record.target.sessionId,
      modRoot: record.target.modRoot,
      changesTarget: selectedId.value === record.target.id,
      label: definition.label + ' "' + record.target.id + '" 已删除',
      write: () => capabilities.remove(record.target, record.baseVersions, deleteSource),
      accept: async () => {
        if (current.value?.target.value?.id === record.target.id) {
          current.value.active.value = false;
          current.value = null;
        }
        editors.releaseEntity(record.target.sessionId, kind, record.target.id);
        formal.value = formal.value.filter((item) => item.record.target.id !== record.target.id);
        if (selectedId.value === record.target.id) selectedId.value = null;
        return Boolean(await load());
      },
    });
  }
  useContextMenuScope({
    identity: () => JSON.stringify([sessionId.value, kind]),
    canRefresh: () => active.value,
    refresh: () =>
      refreshProjectSourcePaths(
        sessionId.value!,
        modRoot.value!,
        [
          modRoot.value! + '/' + definition.directory,
          ...records.value.flatMap((record) => record.baseVersions.map((version) => version.path)),
        ],
        records.value.flatMap((record) => Object.values(record.resources)),
      ),
  });
  watch(
    () => [selectedId.value, ...records.value.map((record) => record.target.id)],
    () => {
      const record = records.value.find((record) => record.target.id === selectedId.value);
      const next = record ? useJsonDocumentSession(definition, record, feedback) : null;
      if (next && formal.value.some((entry) => !entry.document && entry.record.target.id === record!.target.id)) {
        formal.value = formal.value.map((entry) => (entry.record.target.id === record!.target.id ? { ...entry, document: next } : entry));
      }
      if (current.value !== next) {
        if (current.value) current.value.active.value = false;
        current.value = next;
      }
      if (next) next.active.value = active.value;
    },
    { immediate: true },
  );
  watch(
    () => context.manifest.value,
    () => {
      if (kind === 'mod-info') void load();
    },
  );
  watch(
    active,
    (enabled) => {
      if (enabled) void load();
      else reads.revoke();
      if (current.value) current.value.active.value = enabled;
    },
    { immediate: true },
  );
  watch(
    () => settings.isPlainEditMode,
    (plain) => {
      if (plain) {
        reads.revoke('consumer', 'options');
        hullOptions.value = [];
      }
    },
  );
  onScopeDispose(
    subscribeQueryInvalidations((event) => {
      if (
        event.sessionId === sessionId.value &&
        event.scope !== 'session' &&
        (kind === 'mod-info' || hasEntityInvalidation(event, 'entity-list', kind))
      )
        reads.schedule('list', () => {
          void load();
        });
    }),
  );
  onScopeDispose(() => {
    if (current.value) {
      current.value.active.value = false;
    }
  });
  return {
    current,
    items,
    selectedId,
    select: selection.select,
    actionsLocked: selection.locked,
    actionRunning: selection.writing,
    deletedTarget: selection.deletedTarget,
    discardDeletedTarget: selection.discardDeleted,
    hullOptions,
    loadHullOptions,
    listLoadStartedAt,
    create,
    remove,
  };
}
