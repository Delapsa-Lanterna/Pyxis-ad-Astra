import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { editorUiStubs, nSelect } from '@/test/ui-stubs';
import { h, ref } from 'vue';
import { createFieldInputs, provideFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';
import type { SpecShipEditorProps } from '@/app/composables/spec-editor/ship/use-spec-ship-editor-view-model';
import type { RowData } from '@/shared/types/index';
import SpecShipEditor from './SpecShipEditor.vue';
vi.mock('@/services/engine-assets.service', () => ({
  queryEngineRenderAssets: async () => ({ styles: { fixture_engine: {} }, versions: [], resources: {} }),
  hasEngineAssetsInvalidation: () => false,
}));
vi.mock('@/app/composables/use-core-assets', () => ({ useCoreGraphics: () => ({ graphicsPaths: ref([]), loadGraphics: vi.fn() }) }));
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
function openShip(overrides: Partial<SpecShipEditorProps> = {}, inputs?: FieldInputs) {
  const props: SpecShipEditorProps = {
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
  };
  const options = {
    global: { stubs: editorUiStubs },
    attachTo: document.body,
  };
  wrapper = inputs
    ? mount(
        {
          setup() {
            provideFieldInputs(inputs);
            return () => h(SpecShipEditor, props);
          },
        },
        options,
      )
    : mount(SpecShipEditor, { props, ...options });
  return inputs ? wrapper.getComponent(SpecShipEditor) : wrapper;
}
const shortcut = async (editor: Pick<ReturnType<typeof mount>, 'get'>, key: string, ctrl = false) => {
  editor.get('.editor-window').element.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: ctrl, bubbles: true }));
  await flushPromises();
};
function observeReveal(editor: Pick<ReturnType<typeof mount>, 'get'>) {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  const scroll = editor.get('.editor-scroll').element;
  Object.assign(scroll, { getAnimations: () => [], scrollTo: vi.fn() });
  return vi.spyOn(scroll, 'querySelector');
}
describe('ship pointer and inspector actions', () => {
  it('derives fixed weapon inputs from built-in slots and preserves unrelated records', async () => {
    const editor = openShip({
      ship: {
        hullId: 'fixture',
        weaponSlots: [
          { id: 'last', type: 'BUILT_IN' },
          { id: 'ordinary', type: 'BALLISTIC' },
          { id: 'first.with.dot', type: 'BUILT_IN' },
          { id: 'bay', type: 'LAUNCH_BAY' },
        ],
        builtInWeapons: { last: 'weapon', ordinary: 'kept', orphan: 'retained' },
      },
    });
    const group = editor.get('[data-name="builtins"] [data-field-path="builtInWeapons"]');
    expect(
      group
        .findAll('.field-label-key')
        .slice(1)
        .map((label) => label.text()),
    ).toEqual(['last', 'first.with.dot']);
    expect(group.findAllComponents(nSelect).map((select: { props: () => Record<string, unknown> }) => select.props().value)).toEqual([
      'weapon',
      '',
    ]);
    expect(group.findAll('button, input.field-map-key-editor')).toHaveLength(0);
    expect(editor.emitted('draft-changed')).toBeUndefined();
    await flushPromises();
    const retained = group.findAllComponents(nSelect)[1]!;
    retained.element.focus();
    retained.vm.$emit('update:value', 'second-weapon');
    await flushPromises();
    expect(group.findAllComponents(nSelect)[1]!.element).toBe(retained.element);
    expect(document.activeElement).toBe(retained.element);
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toHaveProperty('builtInWeapons', {
      last: 'weapon',
      ordinary: 'kept',
      orphan: 'retained',
      'first.with.dot': 'second-weapon',
    });
    group.findAllComponents(nSelect)[0]!.vm.$emit('update:value', '');
    await flushPromises();
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toHaveProperty('builtInWeapons', {
      ordinary: 'kept',
      orphan: 'retained',
      'first.with.dot': 'second-weapon',
    });
    expect(group.findAllComponents(nSelect)).toHaveLength(2);
  });

  it('follows slot type changes, slot deletion and external acceptance', async () => {
    const editor = openShip({
      ship: {
        hullId: 'fixture',
        weaponSlots: [
          { id: 'A', type: 'BALLISTIC' },
          { id: 'B', type: 'BUILT_IN' },
        ],
        builtInWeapons: { B: 'retained' },
      },
    });
    const labels = () => editor.findAll('[data-name="builtins"] .schema-field .field-label-key').map((label) => label.text());
    expect(labels()).toContain('B');
    await editor.get('[data-name="weapons"] .item-list-button').trigger('click');
    await flushPromises();
    const typeOptions = editor.get('[data-field-path="weaponSlots[0].type"]').getComponent(nSelect).props('options');
    expect(typeOptions).toHaveLength(11);
    expect(typeOptions.map((option: { value: string }) => option.value)).not.toContain('LAUNCH_BAY');
    await editor.get('[data-field-path="weaponSlots[0].type"] select').setValue(JSON.stringify('BUILT_IN'));
    expect(labels().filter((label) => label === 'A' || label === 'B')).toEqual(['A', 'B']);
    await editor.get('[data-field-path="weaponSlots[0].type"] select').setValue(JSON.stringify('ENERGY'));
    expect(labels()).not.toContain('A');
    await editor.findAll('[data-name="weapons"] .item-list-button')[1]!.trigger('click');
    await flushPromises();
    await editor
      .findAll('[data-name="weapons"] .action-group button')
      .find((button) => button.text() === '删除')!
      .trigger('click');
    await flushPromises();
    expect(labels()).not.toContain('B');
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toHaveProperty('builtInWeapons.B', 'retained');
    await editor.setProps({
      ship: { hullId: 'fixture', weaponSlots: [{ id: 'external', type: 'BUILT_IN' }], builtInWeapons: { external: 'loaded' } },
      editContext: { targetKey: 'ship', baselineGeneration: 2, handoff: 'external' },
    });
    expect(labels()).toContain('external');
    expect(editor.get('[data-name="builtins"] [data-field-path="builtInWeapons"]').getComponent(nSelect).props('value')).toBe('loaded');
  });

  it('commits pending weapon input and atomically undoes and redoes a slot rename', async () => {
    const inputs = createFieldInputs();
    const editor = openShip({ ship: { hullId: 'fixture', weaponSlots: [{ id: 'A', type: 'BUILT_IN' }], builtInWeapons: {} } }, inputs);
    const weapon = editor.get('[data-name="builtins"] [data-field-path="builtInWeapons"]').getComponent(nSelect);
    weapon.vm.$emit('search', 'laser');
    expect(inputs.dirty.value).toBe(true);
    expect(editor.emitted('draft-changed')).toBeUndefined();
    await inputs.commit();
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toHaveProperty('builtInWeapons.A', 'laser');
    await editor.get('[data-name="weapons"] .item-list-button').trigger('click');
    await flushPromises();
    const name = editor.get('[data-field-path="weaponSlots[0].id"] input');
    await name.setValue('renamed');
    await inputs.commit();
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({
      weaponSlots: [{ id: 'renamed' }],
      builtInWeapons: { renamed: 'laser' },
    });
    await shortcut(editor, 'z', true);
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({ weaponSlots: [{ id: 'A' }], builtInWeapons: { A: 'laser' } });
    editor.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    await flushPromises();
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({
      weaponSlots: [{ id: 'renamed' }],
      builtInWeapons: { renamed: 'laser' },
    });
  });

  it.each(['BALLISTIC', 'BUILT_IN'])('checks duplicate slot IDs for %s slots without built-in weapon records', async (type) => {
    const inputs = createFieldInputs();
    const editor = openShip(
      {
        ship: {
          hullId: 'fixture',
          weaponSlots: [
            { id: 'A', type },
            { id: 'B', type: 'BALLISTIC' },
          ],
          builtInWeapons: {},
        },
      },
      inputs,
    );
    await editor.get('[data-name="weapons"] .item-list-button').trigger('click');
    await flushPromises();
    const name = editor.get('[data-field-path="weaponSlots[0].id"] input');
    await name.setValue('B');
    await expect(inputs.commit()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(document.activeElement).toBe(name.element);
    expect((name.element as HTMLInputElement).value).toBe('B');
    expect(editor.emitted('draft-changed')).toBeUndefined();
    await name.trigger('keydown', { key: 'Escape' });
    expect((name.element as HTMLInputElement).value).toBe('A');
  });

  it('accepts a slot ID present only in the weapon map and moves its equipped weapon', async () => {
    const inputs = createFieldInputs();
    const editor = openShip(
      {
        ship: { hullId: 'fixture', weaponSlots: [{ id: 'A', type: 'BUILT_IN' }], builtInWeapons: { A: 'laser', destination: 'previous' } },
      },
      inputs,
    );
    await editor.get('[data-name="weapons"] .item-list-button').trigger('click');
    await flushPromises();
    await editor.get('[data-field-path="weaponSlots[0].id"] input').setValue('destination');
    await inputs.commit();
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({
      weaponSlots: [{ id: 'destination' }],
      builtInWeapons: { destination: 'laser' },
    });
  });

  it('edits a slot while preserving ignored root and slot fields', async () => {
    const editor = openShip({
      ship: {
        hullId: 'fixture',
        ignoredRoot: { keep: true },
        weaponSlots: [{ id: 'A', angle: 0, locations: [1, 2], ignoredSlot: { keep: true } }],
      },
    });
    await editor.get('[data-name="weapons"] .item-list-button').trigger('click');
    await flushPromises();
    expect(editor.text()).not.toContain('槽位扩展字段');
    expect(editor.text()).not.toContain('ignoredSlot');
    expect(editor.find('[data-name="extra"]').exists()).toBe(false);
    await editor.get('[data-field-path="weaponSlots[0].angle"] input').setValue('30');
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({
      ignoredRoot: { keep: true },
      weaponSlots: [{ angle: 30, ignoredSlot: { keep: true } }],
    });
  });
  it('uses the formal engine catalogue and keeps deletion within the selected group', async () => {
    const editor = openShip({
      ship: {
        hullId: 'fixture',
        weaponSlots: [{ id: 'slot', locations: [0, 0] }],
        engineSlots: [{ style: 'fixture_engine', location: [0, 0] }],
      },
    });
    await editor.get('[data-name="engines"] .item-list-button').trigger('click');
    await flushPromises();
    expect(editor.get('[data-field-path="engineSlots[0].style"] select').text()).toContain('fixture_engine');
    expect(editor.get('[data-field-path="engineSlots[0].style"] select').text()).not.toContain('MISSILE_HIGH_TECH');
    expect(editor.get('[data-name="engines"] .field-description').text()).toContain('CUSTOM 优先使用 styleId');
    const remove = editor.findAll('[data-name="weapons"] button').find((button) => button.text() === '删除')!;
    expect(remove.attributes('disabled')).toBeDefined();
    await remove.trigger('click');
    expect(editor.emitted('draft-changed')).toBeUndefined();
  });
  it.each([
    ['weapons', 'weapon-0', 'id'],
    ['launchBays', 'launchBay-1', 'id'],
    ['engines', 'engine-0', 'angle'],
  ])('locks %s at the selected field editor', async (section, target, firstKey) => {
    const editor = openShip({
      ship: {
        hullId: 'ship',
        weaponSlots: [
          { id: 'A', locations: [1, 2] },
          { id: 'B', type: 'LAUNCH_BAY', locations: [3, 4, 5, 6] },
        ],
        engineSlots: [{ angle: 30, location: [7, 8] }],
      },
    });
    const query = observeReveal(editor),
      item = editor.get(`[data-name="${section}"] .item-list-button`);
    await item.trigger('click');
    await flushPromises();
    expect(query).toHaveBeenLastCalledWith(`[data-inspector-target="${target}"]`);
    expect(item.classes()).toContain('selected');
    expect(editor.get(`[data-inspector-target="${target}"] .field-label-key`).text()).toBe(firstKey);
    if (section === 'launchBays') {
      const port = editor.get('[data-inspector-target="launchBay-1-port-1"]');
      await port.trigger('click');
      await flushPromises();
      expect(query).toHaveBeenLastCalledWith('[data-inspector-target="launchBay-1-port-1"]');
      expect(port.classes()).toContain('selected');
    }
  });

  it.each([
    ['c', 250, 250, 'center[0]'],
    ['c', 270, 260, 'shieldCenter[0]'],
    ['b', 251, 248, 'bound-0'],
  ])('locks the hovered %s target at its own input row', async (mode, clientX, clientY, target) => {
    const editor = openShip({ ship: { hullId: 'ship', center: [0, 0], shieldCenter: [20, -10], bounds: [1, 2] } });
    const query = observeReveal(editor);
    await shortcut(editor, mode);
    await editor.get('canvas').trigger('mousemove', { clientX, clientY });
    await shortcut(editor, 't');
    expect(editor.find(`[data-field-path="${target}"], [data-inspector-target="${target}"]`).exists()).toBe(true);
    expect(query).toHaveBeenLastCalledWith(`[data-${mode === 'b' ? 'inspector-target' : 'field-path'}="${target}"]`);
  });

  it('groups sprite actions and places the cover color in advanced properties', () => {
    const editor = openShip();
    const buttons = editor.findAll('[data-name="sprite"] .action-group button');
    expect(editor.get('[data-name="advanced"] [data-field-path="coversColor"]').classes()).not.toContain('field-group');
    expect(editor.findAll('[data-name="bounds"] .action-group button').map((button) => button.text())).toEqual(['添加', '删除']);
    expect(editor.get('[data-name="sprite"] .field-description').text()).toContain('中心赋值保持附属相对坐标');
    expect(editor.find('[data-name="engines"] .field-description').exists()).toBe(false);
    expect(buttons.map((button) => button.text())).toEqual(['中心设为图片中心', '按图片更新宽高']);
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
    const path = editor.get('[data-field-path="spriteName"] input');
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
      .find((b) => b.text() === '中心设为图片中心')!
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
