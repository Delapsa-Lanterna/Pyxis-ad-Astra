import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { editorUiStubs } from '@/test/ui-stubs';
import type { SpecShipEditorProps } from '@/app/composables/spec-editor/ship/use-spec-ship-editor-view-model';
import type { RowData } from '@/shared/types/index';
import SpecShipEditor from './SpecShipEditor.vue';
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ warning: vi.fn(), error: vi.fn() }) }));
vi.mock('@/shared/runtime/dialog.runtime', () => ({ pickImageFileDialog: vi.fn(async () => null) }));
vi.mock('@/services/spec-editor.service', () => ({
  querySpecShipWeaponSources: vi.fn(async () => ({ baseVersions: [], hints: [], weapons: {}, diagnostic: '' })),
}));
let wrapper: ReturnType<typeof mount> | null = null;
beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
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
function openShip(overrides: Partial<SpecShipEditorProps> = {}) {
  wrapper = mount(SpecShipEditor, {
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
      ...overrides,
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
  it('places the center action above dimension sync and disables both without a loaded image', () => {
    const editor = openShip();
    const buttons = editor.findAll('.sprite-actions button');
    expect(buttons.map((button) => button.text())).toEqual(['更新舰船中心', '更新贴图宽高']);
    expect(buttons.every((button) => button.attributes('disabled') !== undefined)).toBe(true);
  });
  it.each([true, false])('syncs dimensions on user loading, centers only when initially empty: %s', async (empty) => {
    const loaded: Array<{ width: number; height: number; onload: (() => void) | null; onerror: (() => void) | null; src: string }> = [];
    vi.stubGlobal(
      'Image',
      class {
        width = 101;
        height = 203;
        onload = null;
        onerror = null;
        src = '';
        constructor() {
          loaded.push(this);
        }
      },
    );
    const source = {
      hullId: 'ship',
      spriteName: empty ? '' : 'old.png',
      width: 100,
      height: 150,
      center: [5, 6],
      shieldCenter: [2, 3],
      weaponSlots: [{ id: 'A', locations: [10, 20] }],
      engineSlots: [],
      bounds: [1, 2, 3, 4],
    };
    const editor = openShip({ ship: source, spriteData: empty ? '' : 'old', spriteSourcePath: source.spriteName });
    if (!empty) {
      loaded.at(-1)!.onload?.();
      await flushPromises();
    }
    const path = editor.get('.sprite-field-row input');
    await path.setValue('new.png');
    await editor.setProps({ spriteData: 'new', spriteSourcePath: 'new.png' });
    loaded.at(-1)!.onload?.();
    await flushPromises();
    const draft = editor.emitted('draft-changed')!.at(-1)![0] as RowData;
    expect(draft).toMatchObject({ width: 101, height: 203, center: empty ? [50.5, 101.5] : [5, 6] });
    expect(draft.weaponSlots).toEqual(source.weaponSlots);
    expect(draft.bounds).toEqual(source.bounds);
    expect(draft.shieldCenter).toEqual(source.shieldCenter);
    await shortcut(editor, 'z', true);
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({ width: 100, height: 150, center: [5, 6], spriteName: 'new.png' });
    await editor
      .findAll('button')
      .find((b) => b.text() === '更新舰船中心')!
      .trigger('click');
    await flushPromises();
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({ center: [50.5, 101.5] });
  });
  it('uses passive loading for display and user reload for geometry', async () => {
    const loaded: Array<{ width: number; height: number; onload: (() => void) | null; onerror: (() => void) | null; src: string }> = [];
    vi.stubGlobal(
      'Image',
      class {
        width = 64;
        height = 32;
        onload = null;
        onerror = null;
        src = '';
        constructor() {
          loaded.push(this);
        }
      },
    );
    const editor = openShip({
      ship: { hullId: 'ship', spriteName: 'old.png', width: 100, height: 150, center: [5, 6] },
      spriteData: 'old',
      spriteSourcePath: 'old.png',
    });
    loaded.at(-1)!.onload?.();
    await flushPromises();
    expect(editor.emitted('draft-changed')).toBeUndefined();
    const path = editor.findAll('input').find((input) => (input.element as HTMLInputElement).value === 'old.png')!;
    await path.trigger('change');
    loaded.at(-1)!.onload?.();
    await flushPromises();
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({ width: 64, height: 32, center: [5, 6] });
    await editor.setProps({ spriteData: 'background' });
    loaded.at(-1)!.onload?.();
    await flushPromises();
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({ width: 64, height: 32, center: [5, 6] });
  });
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
