import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { createCanvasRecorder } from '@/test/unit/canvas-recorder';
import { useSettingsStore } from '@/stores/settings.store';
import { flushPromises } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import type { RowData } from '@/shared/types/index';
import { installCanvas2DStub } from '@/test/unit/canvas-stub';
import { editorUiStubs } from '@/test/unit/ui-stubs';

const mocks = vi.hoisted(() => ({
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  },
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

vi.mock('@/shared/runtime/dialog.runtime', () => ({
  pickImageFileDialog: vi.fn(async () => null),
  pickFileDialog: vi.fn(async () => null),
  pickDirectoryDialog: vi.fn(async () => null),
}));

import SpecProjectileEditor from './SpecProjectileEditor.vue';
vi.mock('@/app/composables/use-core-assets', () => ({ useCoreGraphics: () => ({ graphicsPaths: ref([]), loadGraphics: vi.fn() }) }));

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountEditor(projectile: RowData) {
  wrapper = mount(SpecProjectileEditor, {
    props: {
      modRoot: 'M:/mod',
      sessionId: 'sess-1',
      projectileId: 'proj1',
      projectile,
      editContext: null,
      dirty: false,
      canSave: false,
      saving: false,
      externalUpdateNotice: '',
    },
    global: { stubs: editorUiStubs },
    attachTo: document.body,
  });
  return wrapper!;
}

describe('SpecProjectileEditor', () => {
  it('creates missing missile fields and reverses a complete engine insertion with one undo', async () => {
    const editor = mountEditor({ id: 'fixture', specClass: 'missile', extension: { keep: true } });
    expect(editor.find('[data-name="extra"]').exists()).toBe(false);
    expect(editor.text()).not.toContain('extension');
    await editor.setProps({ editContext: { targetKey: 'fixture', baselineGeneration: 1, handoff: 'load' } });
    expect(editor.get('[data-field-path="size[0]"] input').element).toHaveProperty('value', '');
    await editor.get('[data-field-path="engineSpec.acc"] input').setValue('12');
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({ engineSpec: { acc: 12 }, extension: { keep: true } });
    await editor
      .findAll('button')
      .find((button) => button.text() === '添加')!
      .trigger('click');
    await flushPromises();
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toHaveProperty('engineSlots.0.styleSpec.mode', 'QUAD_STRIP');
    editor.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await flushPromises();
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({
      engineSlots: [],
      engineSpec: { acc: 12 },
      extension: { keep: true },
    });
  });
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore(createSettingsFixture());
    initializeCacheLimits(createSettingsFixture().cacheLimits);
    installCanvas2DStub();
  });

  it('keeps view navigation separate from the draft and resets to its current dimensions', async () => {
    const recording = createCanvasRecorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(recording.ctx);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 500, height: 400 } as DOMRect);
    const editor = mountEditor({ id: 'proj1', specClass: 'projectile', length: 40, width: 8 });
    await flushPromises();
    expect(editor.get('.editor-inspector-heading span').text()).toBe('弹体检查器');
    const canvas = editor.get('canvas');
    recording.ops.length = 0;
    await canvas.trigger('mousedown', { button: 2, clientX: 10, clientY: 20 });
    await canvas.trigger('mousemove', { clientX: 40, clientY: 60 });
    await canvas.trigger('mouseup');
    canvas.element.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, clientX: 80, clientY: 100 }));
    expect(recording.calls('translate').map((call) => call.args)).toContainEqual([expect.closeTo(260), expect.closeTo(226)]);
    expect(recording.calls('scale').at(-1)!.args[0]).toBeCloseTo(9.45);
    expect(editor.emitted('draft-changed')).toBeUndefined();
    const width = editor.findAll('input').find((input) => (input.element as HTMLInputElement).value === '8')!;
    await width.setValue('16');
    await flushPromises();
    expect(recording.calls('translate').map((call) => call.args)).toContainEqual([expect.closeTo(260), expect.closeTo(226)]);
    expect(recording.calls('scale').at(-1)!.args[0]).toBeCloseTo(9.45);
    await editor
      .findAll('button')
      .find((button) => button.text() === '适应视图')!
      .trigger('click');
    expect(recording.calls('translate').map((call) => call.args)).toContainEqual([250, 200]);
    expect(recording.calls('scale').at(-1)!.args[0]).toBeCloseTo(10.5);
    const before = editor.emitted('draft-changed')!.length;
    await canvas.trigger('mousedown', { button: 0 });
    await canvas.trigger('mousemove', { clientX: 60, clientY: 70 });
    await canvas.trigger('mouseup');
    expect(editor.emitted('draft-changed')).toHaveLength(before);
  });
  it('redraws themes and DPI while retaining the current view through external acceptance', async () => {
    const recording = createCanvasRecorder();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(recording.ctx);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 500, height: 400 } as DOMRect);
    const editor = mountEditor({ id: 'proj1', specClass: 'missile', size: [10, 20], center: [5, 10], collisionRadius: 10 });
    await flushPromises();
    await editor.get('canvas').trigger('mousedown', { button: 2, clientX: 0, clientY: 0 });
    await editor.get('canvas').trigger('mousemove', { clientX: 30, clientY: 40 });
    await editor.get('canvas').trigger('mouseup');
    await editor.setProps({
      projectile: { id: 'proj1', specClass: 'missile', size: [12, 30], center: [3, 8], collisionRadius: 20 },
      editContext: { targetKey: 'p', baselineGeneration: 2, handoff: 'external' },
    });
    useSettingsStore().setTheme('dark');
    await flushPromises();
    expect(recording.calls('translate').map((call) => call.args)).toContainEqual([280, 240]);
    const canvas = editor.get('canvas').element as HTMLCanvasElement;
    vi.stubGlobal('devicePixelRatio', 2);
    window.dispatchEvent(new Event('resize'));
    await flushPromises();
    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(800);
    expect(recording.calls('setTransform').at(-1)!.args).toEqual([2, 0, 0, 2, 0, 0]);
    const calls = recording.calls('clearRect').length;
    editor.unmount();
    wrapper = null;
    window.dispatchEvent(new Event('resize'));
    expect(recording.calls('clearRect')).toHaveLength(calls);
  });
  it('replaces in-flight decoding and exposes loading and errors in the canvas', async () => {
    const bitmaps: Array<{ onload: (() => void) | null; onerror: (() => void) | null; src: string; width: number; height: number }> = [];
    vi.stubGlobal(
      'Image',
      class {
        width = 10;
        height = 20;
        onload = null;
        onerror = null;
        src = '';
        constructor() {
          bitmaps.push(this);
        }
      },
    );
    const editor = mountEditor({ id: 'proj1', specClass: 'projectile', bulletSprite: 'first.png' });
    await editor.setProps({
      resourceRefs: [{ source: 'mod', ownerKind: 'weapon', ownerId: 'proj1', key: 'bulletSprite', relPath: 'first.png' }],
      spriteLoading: true,
    });
    expect(editor.get('.projectile-canvas-notice[role="status"]').text()).toContain('正在读取');
    await editor.setProps({ spriteLoading: false, spriteData: { bulletSprite: 'first-data' } });
    expect(editor.get('.projectile-canvas-notice[role="status"]').text()).toContain('正在加载');
    await editor.setProps({ spriteData: { bulletSprite: 'second-data' } });
    bitmaps[0]!.onload?.();
    await flushPromises();
    expect(editor.get('.projectile-canvas-notice[role="status"]').text()).toContain('正在加载');
    bitmaps[1]!.onload?.();
    await flushPromises();
    expect(editor.find('.projectile-canvas-notice[role="status"]').exists()).toBe(false);
    await editor.setProps({ spriteData: { bulletSprite: 'broken-data' } });
    bitmaps[2]!.onerror?.();
    await flushPromises();
    expect(editor.get('.projectile-canvas-notice[role="status"]').text()).toContain('无法解码');
    await editor.setProps({ spriteData: {}, spriteError: '路径授权失败' });
    expect(editor.get('.projectile-canvas-notice[role="status"]').text()).toBe('路径授权失败');
    editor.unmount();
    wrapper = null;
    bitmaps[2]!.onload?.();
    await flushPromises();
    expect(mocks.feedback.error).toHaveBeenCalledTimes(1);
  });
  it('renders the editor shell with close and save actions', async () => {
    const editor = mountEditor({ id: 'proj1', specClass: 'projectile' });
    const buttons = editor.findAll('button').map((button) => button.text());
    expect(buttons).toContain('关闭');
    expect(buttons).toContain('保存');
  });

  it('switches the spec class branch through the select', async () => {
    const editor = mountEditor({ id: 'proj1', specClass: 'projectile' });
    const selects = editor.findAll('select');
    await selects[0]!.setValue(JSON.stringify('missile'));
    await nextTick();
    const last = editor.emitted('draft-changed')?.at(-1)?.[0] as Record<string, unknown>;
    expect(last.specClass).toBe('missile');
    expect(last.engineSpec).toEqual({ turnAcc: 0, turnRate: 0, acc: 0, dec: 0 });
    expect(last.size).toEqual([10, 20]);
    expect(last.sprite).toBe('');
  });

  it('hides projectile-only sections for missiles', async () => {
    const editor = mountEditor({ id: 'proj1', specClass: 'missile' });
    expect(editor.html()).not.toContain('弹体外观');
    expect(editor.get('[data-name="flight"] .field-description').text()).toContain('装备后的速度与飞行时间由武器 CSV 对应值覆盖');
    expect(editor.get('[data-name="scripts"] .field-description').text()).toContain('behavior 支持 PROXIMITY_FUSE、MIRV、CUSTOM');
    expect(editor.find('[data-name="slots"] .field-description').exists()).toBe(false);
    await editor.setProps({
      projectile: { id: 'proj1', specClass: 'missile', engineSlots: [{ id: 'engine', style: 'CUSTOM' }] },
      editContext: { targetKey: 'proj1', baselineGeneration: 1, handoff: 'load' },
    });
    expect(editor.get('[data-name="slots"] .field-description').text()).toBe('styleId 优先；内联样式支持 PARTICLES 与 QUAD_STRIP。');
  });

  it('adds game-loadable engines with unique ids after deletion', async () => {
    const editor = mountEditor({
      id: 'proj1',
      specClass: 'missile',
      engineSlots: [
        { id: 'ES1', loc: [1, 2] },
        { id: 'ES3', loc: [3, 4] },
      ],
    });
    await editor
      .findAll('button')
      .find((button) => button.text() === '添加')!
      .trigger('click');
    const draft = editor.emitted('draft-changed')!.at(-1)![0] as RowData;
    const slots = draft.engineSlots as RowData[];
    expect(slots.map((slot) => slot.id)).toEqual(['ES1', 'ES3', 'ES2']);
    expect(slots[2]).toMatchObject({ id: 'ES2', loc: [0, 0], angle: 180, width: 8, length: 20, style: 'CUSTOM' });
    expect(slots[2]!.styleSpec).toMatchObject({
      mode: 'QUAD_STRIP',
      engineColor: [255, 145, 75, 255],
      contrailColor: [100, 100, 100, 150],
      contrailDuration: 0.5,
      contrailWidthMult: 2,
      contrailMaxSpeedMult: 0,
      contrailAngularVelocityMult: 0.5,
      type: 'SMOKE',
    });
  });

  it('offers the game projectile spawn enum', () => {
    const editor = mountEditor({ id: 'proj1', specClass: 'projectile' });
    const options = editor
      .findAll('select')[1]!
      .findAll('option')
      .map((option) => option.text());
    expect(options).toEqual(['BEAM', 'BALLISTIC_AS_BEAM', 'BALLISTIC', 'PLASMA', 'MISSILE', 'OTHER']);
  });

  it('offers both phase missile types accepted by the game', () => {
    const editor = mountEditor({ id: 'proj1', specClass: 'missile' });
    const options = editor
      .findAll('select')[1]!
      .findAll('option')
      .map((option) => option.text());
    expect(options).toContain('PHASE_CHARGE');
    expect(options).toContain('PHASE_MINE');
    expect(options).toHaveLength(17);
  });
});
vi.mock('@/services/engine-assets.service', () => ({
  queryEngineRenderAssets: async () => ({ styles: {}, versions: [], resources: {} }),
  hasEngineAssetsInvalidation: () => false,
}));
