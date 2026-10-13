import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializeSettingsStore } from '@/stores/settings.store';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { editorUiStubs } from '@/test/ui-stubs';
import type { RowData } from '@/shared/types';
import ShipEditor from './ShipEditor.vue';
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ warning: vi.fn(), error: vi.fn() }) }));
vi.mock('@/shared/runtime/dialog.runtime', () => ({ pickImageFileDialog: vi.fn(async () => null) }));
vi.mock('@/services/editor.service', () => ({ queryShipWeaponSources: vi.fn(async () => ({ hints: [], weapons: {}, diagnostic: '' })) }));
let wrapper: ReturnType<typeof mount> | null = null;
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore({
    theme: 'light',
    accent: 'blue',
    customAccent: '#2563eb',
    fileHistoryLimit: 20,
    editHistoryLimit: 250,
    logRotationSizeMiB: 5,
    logBackupCount: 1,
    editMode: 'smart',
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
  });
  installCanvas2DStub();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 500,
    bottom: 500,
    width: 500,
    height: 500,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function openShip() {
  wrapper = mount(ShipEditor, {
    props: {
      modRoot: 'M:/mod',
      sessionId: 's1',
      hullId: 'ship',
      ship: { hullId: 'ship', center: [0, 0], shieldCenter: [0, 0], weaponSlots: [], engineSlots: [], bounds: [], custom: { keep: true } },
      editContext: { targetKey: 'ship', baselineGeneration: 1, handoff: 'load' },
      dirty: false,
      canSave: true,
      saving: false,
      externalUpdateNotice: '',
    },
    global: { stubs: editorUiStubs },
    attachTo: document.body,
  });
  return wrapper;
}
const shortcut = async (editor: ReturnType<typeof mount>, key: string, ctrl = false) => {
  editor.get('.editor-window').element.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: ctrl, bubbles: true }));
  await flushPromises();
};
describe('ship pointer and inspector actions', () => {
  it('creates and moves a mirrored slot pair through the real canvas, then undoes and redoes the whole gesture', async () => {
    const editor = openShip();
    await flushPromises();
    await shortcut(editor, 'w');
    await shortcut(editor, ' ');
    const canvas = editor.get('canvas');
    await canvas.trigger('mousedown', { button: 0, shiftKey: true, clientX: 300, clientY: 220 });
    await canvas.trigger('mousemove', { shiftKey: true, clientX: 310, clientY: 215 });
    expect(editor.emitted('draft-changed')).toBeUndefined();
    await canvas.trigger('mouseup');
    await flushPromises();
    const draft = editor.emitted('draft-changed')!.at(-1)![0] as RowData;
    expect((draft.weaponSlots as RowData[]).map((x) => x.locations)).toEqual([
      [60, 35],
      [60, -35],
    ]);
    expect((draft.weaponSlots as RowData[]).map((x) => x.id)).toEqual(['WS0001', 'WS0002']);
    expect(draft.custom).toEqual({ keep: true });
    await shortcut(editor, 'z', true);
    expect((editor.emitted('draft-changed')!.at(-1)![0] as RowData).weaponSlots).toEqual([]);
    editor
      .get('.editor-window')
      .element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    await flushPromises();
    expect(((editor.emitted('draft-changed')!.at(-1)![0] as RowData).weaponSlots as RowData[]).map((x) => x.locations)).toEqual([
      [60, 35],
      [60, -35],
    ]);
  });
  it('completes invalid-context release without applying a late pointer action', async () => {
    const editor = openShip();
    await flushPromises();
    await shortcut(editor, 'w');
    await editor.setProps({
      ship: { hullId: 'ship', center: [0, 0], shieldCenter: [0, 0], weaponSlots: [], custom: { external: true } },
      editContext: { targetKey: 'ship', baselineGeneration: 2, handoff: 'external' },
    });
    await flushPromises();
    await editor.get('canvas').trigger('mouseup');
    expect(editor.emitted('draft-changed')).toBeUndefined();
  });
});
