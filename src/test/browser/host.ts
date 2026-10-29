/* eslint-disable vue/one-component-per-file -- Browser scenes compose the formal providers and content. */
import { createApp, defineComponent, h, nextTick, onScopeDispose, ref, type App } from 'vue';
import { createPinia, disposePinia, type Pinia } from 'pinia';
import WindowShell from '@/app/WindowShell.vue';
import { installNaiveUi } from '@/app/naive-ui.runtime';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { initializeSettings } from '@/orchestrators/settings-persistence.orchestrator';
import { initializeWindowContext } from '@/windows/window-context.window';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useJsonEditorStore } from '@/stores/json-editor.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useCsvEditorActions } from '@/app/composables/csv-editor/use-csv-editor-actions';
import { useCsvSaveParticipants } from '@/app/composables/csv-editor/use-csv-save-participants';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { projectVariantPanel } from '@/domain/immersive/variant/variant-panel';
import { invalidateQueryCacheForSession } from '@/services/query-cache.service';
import { resourceMediaStats } from '@/services/resource-media.service';
import { invalidateResourceMediaForSession } from '@/services/resource-media.service';
import { flushSettings } from '@/orchestrators/settings-persistence.orchestrator';
import { flushApplicationLogs } from '@/services/app-log.service';
import { startPerformanceMonitor, flushPerformanceMonitor } from '@/app/performance-monitor';
import { installBrowserModel } from './runtime/commands';
import { emit } from './runtime/events';
import { provideFieldInputs } from '@/shared/runtime/field-inputs';
import type { BrowserModel } from './scenarios/model';
import type { AppSettings } from '@/shared/types';
import '@/styles/style.css';
import './browser.css';

const immersiveKinds = ['ship', 'skin', 'weapon', 'wing', 'variant'] as const;
export function createBrowserHost(element: HTMLElement) {
  let app: App | null = null;
  let pinia: Pinia | null = null;
  let model: BrowserModel;
  let stopMonitor: (() => void) | undefined;
  let tables: ReturnType<typeof useCsvEditorStore>;
  let settings: ReturnType<typeof useSettingsStore>;
  let initialized = false;
  let settingsVersion = 0;
  let windowVersion = 0;
  let remainingSessions = 0;
  function unmount() {
    if (app) {
      settingsVersion = model.settingsSnapshot().revision;
      windowVersion = model.context?.revision ?? windowVersion;
    }
    app?.unmount();
    app = null;
  }
  async function close() {
    if (app) {
      await flushSettings();
      await useSaveCommandStore(pinia!).waitForSaves();
      settingsVersion = model.settingsSnapshot().revision;
      windowVersion = model.context?.revision ?? windowVersion;
    }
    unmount();
    await flushPerformanceMonitor();
    stopMonitor?.();
    stopMonitor = undefined;
    await flushApplicationLogs();
    if (model) {
      invalidateQueryCacheForSession(model.sessionId);
      invalidateResourceMediaForSession(model.sessionId);
    }
    tables?.removeModState(model.manifest.modRoot);
    if (pinia && model) useJsonEditorStore(pinia).releaseSession(model.sessionId);
    if (pinia) {
      remainingSessions = useSaveCommandStore(pinia).editTargets.length;
      disposePinia(pinia);
    }
    pinia = null;
  }
  async function open(next: BrowserModel, monitor = false) {
    await close();
    model = next;
    model.rebase(settingsVersion, windowVersion);
    delete element.dataset.selectedId;
    installBrowserModel(model);
    const kind = immersiveKinds.find((kind) => kind === model.scene);
    if (kind) model.windowContext(kind);
    await initializeWindowContext();
    if (!initialized) {
      await initializeSettings();
      initialized = true;
    } else await emit('app-settings-changed', model.settingsSnapshot());
    initializeSettingsStore(model.settings);
    pinia = createPinia();
    stopMonitor = startPerformanceMonitor(pinia, monitor);
    model.monitor.enabled = monitor;
    const SceneContent = await (async () => {
      if (model.scene === 'fields') return (await import('./FieldGallery.vue')).default;
      if (model.scene === 'resources') return (await import('./ResourceGallery.vue')).default;
      if (model.scene === 'feedback') return (await import('./FeedbackGallery.vue')).default;
      if (model.scene === 'csv') return (await import('@/app/components/csv-editor/CsvEditorWorkspace.vue')).default;
      if (immersiveKinds.includes(model.scene as (typeof immersiveKinds)[number]))
        return (await import('@/app/ImmersiveEditorContent.vue')).default;
      if (model.scene === 'hullmods') return (await import('@/app/components/immersive/variant/VariantHullmodPicker.vue')).default;
      return (await import('@/app/components/immersive/variant/VariantPicker.vue')).default;
    })();
    const Scene = defineComponent({
      setup() {
        settings = useSettingsStore();
        if (['fields', 'resources', 'feedback'].includes(model.scene)) return () => h(SceneContent);
        if (kind) return () => h(SceneContent);
        const workspace = useWorkspaceStore();
        workspace.registerMod({ modRoot: model.manifest.modRoot, displayName: '浏览器样本', version: '', status: 'ready' });
        useProjectStore().registerProjectManifest(model.manifest);
        if (model.scene === 'csv') {
          tables = useCsvEditorStore();
          tables.initializeModTables({ sessionId: model.sessionId, modRoot: model.manifest.modRoot, manifest: model.manifest });
          workspace.activateModTable(model.manifest.modRoot);
          const feedback = useAppFeedback();
          const actions = useCsvEditorActions(feedback);
          useCsvSaveParticipants(feedback, actions.selectAssociatedSpecs);
          return () => h(SceneContent, { detailPaneExpanded: false, actions });
        }
        const graph = model.graph('variant');
        const inputs = provideFieldInputs();
        onScopeDispose(inputs.release);
        const variant = projectVariantPanel(graph, {}).variants[0]!;
        const selectedId = ref('');
        const selected = (id: string) => {
          selectedId.value = id;
          element.dataset.selectedId = id;
        };
        const closePicker = () => void emit('browser-close', null);
        return () =>
          model.scene === 'hullmods'
            ? h(SceneContent, { root: graph.root, variant, onSelect: selected, onManualCommit: selected, onClose: closePicker })
            : h(SceneContent, {
                root: graph.root,
                kind: model.scene as 'weapons' | 'wings',
                currentId: selectedId.value,
                anchor: { x: 20, y: 20 },
                weaponSlot: { type: 'BALLISTIC', size: 'MEDIUM' },
                commitManual: async (id: string) => {
                  selected(id);
                  return true;
                },
                onSelect: selected,
                onClose: closePicker,
              });
      },
    });
    app = createApp({
      setup: () => () =>
        h(
          WindowShell,
          { mode: 'main', appearance: kind ? 'immersive' : 'application' },
          {
            default: () => h('div', { class: 'browser-scene' }, [h(Scene)]),
          },
        ),
    }).use(pinia);
    installNaiveUi(app);
    const started = performance.now();
    app.mount(element);
    await nextTick();
    return started;
  }
  return {
    open,
    close,
    unmount,
    async save() {
      if (model.scene === 'csv') await tables.activeEditor!.save();
      else await useJsonEditorStore(pinia!).active!.save();
    },
    get remainingSessions() {
      return remainingSessions;
    },
    get model() {
      return model;
    },
    get mediaStats() {
      return resourceMediaStats();
    },
    get tables() {
      return tables;
    },
    get settings() {
      return settings;
    },
    setAppearance(patch: Partial<Pick<AppSettings, 'theme' | 'accent' | 'customAccent'>>) {
      if (patch.theme) settings.setTheme(patch.theme);
      if (patch.accent) settings.setAccent(patch.accent);
      if (patch.customAccent) settings.setCustomAccent(patch.customAccent);
    },
    setTheme: (theme: 'light' | 'dark') => settings.setTheme(theme),
  };
}
