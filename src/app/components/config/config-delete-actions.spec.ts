import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import ConfigFactionEditor from './ConfigFactionEditor.vue';
import ConfigMissionEditor from './ConfigMissionEditor.vue';
import { editorUiStubs } from '@/test/ui-stubs';

const feedback = vi.hoisted(() => ({ confirmDanger: vi.fn(), error: vi.fn() }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => feedback }));
vi.mock('@/app/composables/use-core-assets', () => ({ useCoreSchema: () => ({ getMergedSchema: () => ({}), loadCoreFields: vi.fn() }) }));
vi.mock('@/app/composables/config/use-config-faction-editor-view-model', () => ({
  useConfigFactionEditorViewModel: () => ({
    dirty: ref(false),
    reset: vi.fn(),
    paths: ref('source.faction'),
    draftData: ref({}),
    externalUpdateNotice: ref(''),
    loadPendingExternalData: vi.fn(),
    logoSrc: ref(''),
    crestSrc: ref(''),
    displayName: ref('Sample'),
    save: vi.fn(),
    saving: ref(false),
    handoffLocked: ref(false),
  }),
}));
vi.mock('@/app/composables/config/use-config-mission-editor-view-model', () => ({
  useConfigMissionEditorViewModel: () => ({
    dirty: ref(false),
    reset: vi.fn(),
    paths: ref('definition.json'),
    draftData: ref({}),
    editingMissionId: ref('sample'),
    displayName: ref('Sample'),
    externalUpdateNotice: ref(''),
    iconSrc: ref(''),
    loadPendingExternalData: vi.fn(),
    loadedMissionId: ref('sample'),
    save: vi.fn(),
    saving: ref(false),
    handoffLocked: ref(false),
  }),
}));
describe('configuration deletion options', () => {
  it.each(['faction', 'mission'] as const)('passes the selected source-removal policy for %s', async (kind) => {
    const remove = vi.fn(async () => true);
    const shared = {
      actionsLocked: false,
      deletedTarget: false,
      discardDeletedTarget: vi.fn(),
      identityHandoff: null,
      modRoot: 'M:/sample',
      sessionId: 'sample-session',
    };
    const view =
      kind === 'faction'
        ? mount(ConfigFactionEditor, {
            props: {
              ...shared,
              factionId: 'sample',
              factions: {},
              factionVersions: {},
              dataRevision: 0,
              previewRevision: 0,
              schemaRuntimeContext: null,
              queryPreviewImages: async () => ({ logoSrc: '', crestSrc: '' }),
              saveFaction: async () => null,
              deleteFaction: remove,
            },
            global: { plugins: [createPinia()], stubs: { ...editorUiStubs, SchemaFormRenderer: true } },
          })
        : mount(ConfigMissionEditor, {
            props: {
              ...shared,
              missionId: 'sample',
              editorReloadToken: 0,
              iconRefreshToken: 0,
              queryMissionEditorData: async () => null,
              queryMissionIcon: async () => '',
              saveMission: async () => null,
              deleteMission: remove,
            },
            global: { plugins: [createPinia()], stubs: { ...editorUiStubs, SchemaFormRenderer: true } },
          });
    for (const removeSource of [false, true]) {
      await view
        .findAll('button')
        .find((button) => button.text() === '删除')!
        .trigger('click');
      const confirmation = feedback.confirmDanger.mock.lastCall![0];
      const content = confirmation.content();
      const checkbox = content.children[1];
      expect(checkbox.props.checked).toBe(false);
      checkbox.props['onUpdate:checked'](removeSource);
      expect(confirmation.content().children[1].props.checked).toBe(removeSource);
      await confirmation.onConfirm();
      expect(remove).toHaveBeenLastCalledWith('sample-session', 'M:/sample', 'sample', removeSource);
    }
    view.unmount();
  });
});
