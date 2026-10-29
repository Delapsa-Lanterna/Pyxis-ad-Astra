import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { queryMiscConfigFiles, queryMiscConfigFile, hasMiscConfigInvalidation } from '@/services/misc-config.service';
import { MISC_CONFIG_FILES, miscConfigFile, miscConfigValue } from '@/domain/json-editor/misc-config-files';
import type { JsonEditorContext } from './json-editor-context';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { useJsonDocumentSession, type JsonDocumentSession } from './use-json-document-session';
import { useJsonListSelection } from './use-json-list-selection';
import { createJsonDocument, deleteJsonDocument } from './json-document-capabilities';
import { useJsonEditorStore, type JsonDocumentState, type JsonSearchField } from '@/stores/json-editor.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import {
  jsonDocumentRecord,
  jsonDocumentMedia,
  jsonDocumentSummary,
  jsonDocumentValue,
  type JsonDocumentDefinition,
  type JsonDocumentRecord,
} from '@/domain/json-editor/json-document-definitions';
import { querySessionEntity, querySessionEntityList, hasEntityInvalidation } from '@/services/entity-query.service';
import { queryHullReferenceOptions, querySessionHullReferences } from '@/services/hull-reference.service';

import { refreshProjectSourcePaths, observeSavedContent, saveProjection } from '@/orchestrators/project-sync.orchestrator';
import { focusExistingEntityWindow } from '@/orchestrators/window-target-focus.orchestrator';
import { warningNotice } from '@/shared/lib/errors';
import { startPerformance } from '@/shared/runtime/performance';
import type { SelectOption } from '@/domain/schema/schema-options';
import type { DeepReadonly, JsonValue, MiscConfigEntry } from '@/shared/types';

export function useJsonEditorViewModel(definition: JsonDocumentDefinition, context: JsonEditorContext) {
  const feedback = useAppFeedback();
  const editors = useJsonEditorStore();
  const workspace = useWorkspaceStore();
  const settings = useSettingsStore();
  const reads = useQueryReadOwner();
  const { kind } = definition;
  const { modRoot, sessionId, active } = context;
  const search = editors.search(sessionId.value!, kind);
  let disposed = false;
  async function setSearch(text: string, field: JsonSearchField) {
    try {
      if (await selection.prepare()) Object.assign(search, { text, field });
    } catch (error) {
      if (!disposed && active.value) feedback.error(error, '筛选' + definition.label + '失败');
    }
  }
  const formal = shallowRef<Array<{ record: JsonDocumentRecord; document: JsonDocumentState | null }>>([]);
  const hullNames = ref<Record<string, string>>({});
  const hullOptions = shallowRef<SelectOption[]>([]);
  const listLoadStartedAt = ref(0);
  const current = shallowRef<JsonDocumentSession | null>(null);
  const listFailed = ref(false);
  const directory = shallowRef<DeepReadonly<MiscConfigEntry[]>>([]);
  const fileError = shallowRef<unknown>(null);
  const fileLoading = ref(false);
  const selectedId = editors.selection(sessionId.value!, kind);
  const selection = useJsonListSelection({
    selectedId,
    modRoot,
    sessionId,
    label: definition.label,
    discard: async (id) => {
      if (!(await load()) || selectedId.value !== id) return false;
      activateRecord();
      selectedId.value = null;
      editors.releaseEntity(sessionId.value!, kind, id);
      selection.reconcile(items.value.map((item) => item.key));
      return true;
    },
  });
  const documents = computed(() => editors.documentStates(sessionId.value!).filter((document) => document.target.value?.kind === kind));
  const documentIndex = computed(() => {
    const source = new Map<string, JsonDocumentState>(),
      target = new Map<string, JsonDocumentState>();
    for (const document of documents.value) {
      if (!source.has(document.sourceTarget.value.id)) source.set(document.sourceTarget.value.id, document);
      if (!target.has(document.target.value!.id)) target.set(document.target.value!.id, document);
    }
    return { source, target, retained: new Set(documents.value) };
  });
  function bindRecord(record: JsonDocumentRecord) {
    return { record, document: documentIndex.value.source.get(record.target.id) ?? null };
  }
  function boundDocument(entry: (typeof formal.value)[number]) {
    return entry.document && documentIndex.value.retained.has(entry.document) ? entry.document : bindRecord(entry.record).document;
  }
  const records = computed(() => {
    const bound = new Set<JsonDocumentState>();
    const result = formal.value.map((entry) => {
      const document = boundDocument(entry);
      if (document) bound.add(document);
      return document?.record.value ?? entry.record;
    });
    return [...result, ...documents.value.filter((document) => !bound.has(document)).map((document) => document.record.value)];
  });
  type Item = ReturnType<typeof jsonDocumentSummary> & {
    key: string;
    filename: string;
    state: string;
    dirty: boolean;
    missing: boolean;
    resource: ReturnType<typeof jsonDocumentMedia>;
  };
  const items = computed<Item[]>((previous) => {
    const before = new Map(previous?.map((item) => [item.key, item]));
    function retain(item: Item) {
      const old = before.get(item.key);
      return old && stableDeepEqual(old, item) ? old : item;
    }
    const rows = records.value.map((record) => {
      const document = documentIndex.value.target.get(record.target.id);
      return retain({
        key: record.target.id,
        filename: '',
        state: '',
        ...jsonDocumentSummary(definition, record, document?.draftValue.value, hullNames.value),
        dirty: document?.dirty.value ?? false,
        missing: document?.sourceMissing.value ?? false,
        resource: jsonDocumentMedia(record),
      });
    });
    if (kind === 'misc-config')
      return MISC_CONFIG_FILES.map((file) => {
        const row = rows.find((row) => row.key === file.kind);
        const entry = directory.value.find((entry) => entry.kind === file.kind);
        return retain({
          key: file.kind,
          id: file.kind,
          title: file.label,
          filename: file.filename,
          color: '',
          resource: null,
          dirty: row?.dirty ?? false,
          missing: row?.missing ?? false,
          state: fileError.value && selectedId.value === file.kind ? 'error' : (entry?.state ?? ''),
          companion: '',
        });
      });
    return kind === 'mission' || kind === 'mod-info'
      ? rows
      : rows.sort((a, b) => a.companion.localeCompare(b.companion) || a.key.localeCompare(b.key));
  });
  watch([items, () => workspace.entityLocation, active], async () => {
    const location = workspace.entityLocation;
    if (
      !active.value ||
      !location ||
      location.sessionId !== sessionId.value ||
      location.modRoot !== modRoot.value ||
      location.kind !== kind ||
      !items.value.some((item) => item.key === location.id)
    )
      return;
    await selection.select(location.id);
    if (workspace.entityLocation === location && selectedId.value === location.id) workspace.entityLocation = null;
  });
  async function load(required = false) {
    listLoadStartedAt.value = startPerformance();
    if (kind === 'misc-config') {
      const scope = { sessionId: sessionId.value!, modRoot: modRoot.value! };
      const accepted = await reads.consume('list', scope, (signal) => queryMiscConfigFiles(scope.sessionId, scope.modRoot, signal), {
        ready: (files) => {
          directory.value = [...files];
          listFailed.value = false;
        },
        error: (error) => {
          listFailed.value = true;
          fileError.value = error;
          feedback.error(error, '读取杂项配置目录失败');

          if (required) throw error;
        },
      });
      if (!accepted) return false;
    } else if (kind === 'mod-info') {
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
        (signal) =>
          querySessionEntityList(sessionId.value!, kind, signal).then((entities) =>
            entities.map((entity) => jsonDocumentRecord(sessionId.value!, modRoot.value!, entity)),
          ),
        {
          ready: (records) => {
            listFailed.value = false;
            formal.value = records.map(bindRecord);
          },
          error: (error) => {
            listFailed.value = true;
            feedback.error(error, '加载' + definition.label + '失败');

            if (required) throw error;
          },
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
        error: (error) => {
          feedback.error(error, '读取船体名称失败');
          if (required) throw error;
        },
      });
    }
    return true;
  }
  async function loadSelectedFile() {
    reads.revoke('consumer', 'file');
    fileError.value = null;
    fileLoading.value = false;
    const id = selectedId.value;
    if (!active.value || !id || records.value.some((record) => record.target.id === id)) return;
    const entry = directory.value.find((entry) => entry.kind === id);
    if (!entry || entry.state === 'missing') return;
    if (entry.error) {
      fileError.value = entry.error;
      return;
    }
    const scope = { sessionId: sessionId.value!, modRoot: modRoot.value!, kind: miscConfigFile(id).kind };
    fileLoading.value = true;
    await reads.consume('file', scope, (signal) => queryMiscConfigFile(scope.sessionId, scope.modRoot, scope.kind, signal), {
      ready: (file) => {
        if (file) {
          const record: JsonDocumentRecord = {
            target: { ...scope, kind: 'misc-config', id, entity: null },
            value: miscConfigValue(id, cloneQuerySnapshot<JsonValue>(file.data)),
            baseVersions: [...file.baseVersions],
            resources: {},
          };
          formal.value = [...formal.value, bindRecord(record)];
          activateRecord(record, true);
        } else directory.value = directory.value.map((item) => (item.kind === id ? { ...item, state: 'missing', error: null } : item));
      },
      error: (error) => {
        fileError.value = error;
      },
      settled: () => {
        fileLoading.value = false;
      },
    });
  }
  if (kind === 'misc-config') {
    selection.reconcile(items.value.map((item) => item.key));
    watch([selectedId, directory, active], () => {
      void loadSelectedFile();
    });
  }
  async function loadHullOptions() {
    if (!definition.file || settings.isPlainEditMode) return;
    await reads.consume('options', { sessionId: sessionId.value! }, (signal) => queryHullReferenceOptions(sessionId.value!, [], signal), {
      ready: (options) => {
        hullOptions.value = options;
      },
      error: (error) => feedback.error(error, '读取船体引用失败'),
    });
  }
  async function create(id: string, companion: string) {
    if (kind !== 'misc-config' && items.value.some((item) => item.key === id)) {
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
      write: (request) => createJsonDocument(definition, target, id, companion, request),
      accept: async () => {
        if (!(await load())) return false;
        selectedId.value = id;
        return true;
      },
    });
  }
  async function remove(record: JsonDocumentRecord, deleteSource: boolean) {
    if (
      (kind === 'variant' || kind === 'skin') &&
      current.value?.sourceMissing.value &&
      current.value.target.value?.id === record.target.id
    )
      return selection.discardMissing(record.target.id);
    return selection.mutate({
      sessionId: record.target.sessionId,
      modRoot: record.target.modRoot,
      changesTarget: selectedId.value === record.target.id,
      label: definition.label + ' "' + record.target.id + '" 已删除',
      write: (request) => deleteJsonDocument(record.target, record.baseVersions, deleteSource, request),
      accept: async () => {
        if (current.value?.target.value?.id === record.target.id) {
          current.value.setActive(false);
          current.value = null;
        }
        editors.releaseEntity(record.target.sessionId, kind, record.target.id);
        formal.value = formal.value.filter((item) => item.record.target.id !== record.target.id);
        if (kind !== 'misc-config' && selectedId.value === record.target.id) selectedId.value = null;
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
  function activateRecord(record?: JsonDocumentRecord, fresh = false) {
    const next = record ? useJsonDocumentSession(definition, record, feedback) : null;
    if (next && formal.value.some((entry) => !entry.document && entry.record.target.id === record!.target.id)) {
      formal.value = formal.value.map((entry) => (entry.record.target.id === record!.target.id ? { ...entry, document: next } : entry));
    }
    if (current.value !== next) {
      if (current.value) current.value.setActive(false);
      current.value = next;
    }
    if (next) next.setActive(active.value, fresh);
  }
  watch(
    () => [selectedId.value, ...records.value.map((record) => record.target.id)],
    () => {
      reads.revoke('consumer', 'selected');
      const record = records.value.find((record) => record.target.id === selectedId.value);
      if (record && kind === 'mission' && !documents.value.some((document) => document.target.value!.id === record.target.id)) {
        activateRecord();
        const target = record.target;
        void reads.consume('selected', target, (signal) => querySessionEntity(target.sessionId, kind, target.id, signal), {
          ready: (entity) => {
            if (entity) activateRecord(jsonDocumentRecord(target.sessionId, target.modRoot, entity));
          },
          error: (error) => feedback.error(error, '读取战役失败'),
        });
      } else activateRecord(record);
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
      if (current.value) current.value.setActive(enabled);
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
    observeSavedContent((event) => {
      if (selection.isOwnSave(event.result.requestId)) return;
      const projection = saveProjection(event, sessionId.value);
      if (!projection) return;
      if (
        projection.manifest.sessionId === sessionId.value &&
        (kind === 'mod-info' ||
          (kind === 'misc-config'
            ? hasMiscConfigInvalidation(projection.invalidation, modRoot.value!)
            : hasEntityInvalidation(projection.invalidation, 'entity-list', kind)))
      )
        return load(true);
    }),
  );
  onScopeDispose(() => {
    disposed = true;
    if (current.value) {
      current.value.setActive(false);
    }
  });
  return {
    search,
    setSearch,
    current,
    selectedFile: computed(() => (kind === 'misc-config' && selectedId.value ? miscConfigFile(selectedId.value) : null)),
    fileError,
    fileLoading: computed(() => fileLoading.value || (!directory.value.length && !listFailed.value)),
    retryFile: load,
    repairFile: () => feedback.error(fileError.value, '读取杂项配置失败'),
    listFailed,
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
