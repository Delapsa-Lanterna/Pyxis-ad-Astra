import { flushPromises } from '@vue/test-utils';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { h } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RowData } from '@/shared/types';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { createCanvasRecorder } from '@/test/canvas-recorder';
import { editorUiStubs } from '@/test/ui-stubs';
import { provideFieldInputs } from '@/shared/runtime/field-inputs';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';

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

import WeaponEditor from './WeaponEditor.vue';

let wrapper: import('@vue/test-utils').VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountEditor(weapon: RowData, spriteData: Record<string, string> = {}, withInputs = false) {
  const props = {
    modRoot: 'M:/mod',
    sessionId: 'sess-1',
    weaponId: 'railgun',
    weapon,
    spriteData,
    projectileOptions: [{ label: 'proj1', value: 'proj1' }],
    editContext: null,
    dirty: false,
    canSave: false,
    saving: false,
    externalUpdateNotice: '',
  };
  const options = {
    global: { stubs: editorUiStubs },
    attachTo: document.body,
  };
  wrapper = withInputs
    ? mount(
        {
          setup() {
            provideFieldInputs();
            return () => h(WeaponEditor, props);
          },
        },
        options,
      )
    : mount(WeaponEditor, { props, ...options });
  return withInputs ? wrapper.getComponent(WeaponEditor) : wrapper;
}

function installGlowRuntime() {
  const recording = createCanvasRecorder();
  const tint = {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(0) })),
    putImageData: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return this.classList.contains('editor-canvas') ? recording.ctx : (tint as unknown as CanvasRenderingContext2D);
  });
  const images: Array<{ onload: (() => void) | null; src: string }> = [];
  vi.stubGlobal(
    'Image',
    class {
      width = 2;
      height = 2;
      onload: (() => void) | null = null;
      src = '';
      constructor() {
        images.push(this);
      }
    },
  );
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (frame: number) => frames.delete(frame));
  return {
    recording,
    tint,
    images,
    frames,
    load: async () => {
      for (const image of images) image.onload?.();
      await flushPromises();
    },
    advance: (time: number) => {
      const [frame, callback] = [...frames][0]!;
      frames.delete(frame);
      callback(time);
    },
  };
}

describe('WeaponEditor', () => {
  it('creates an above-below pair through the real pointer and deletes the pair as one reversible action', async () => {
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
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile', turretOffsets: [], turretAngleOffsets: [] });
    await editor.setProps({ editContext: { targetKey: 'weapon', baselineGeneration: 1, handoff: 'load' } });
    editor.get('.editor-window').element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await flushPromises();
    const canvas = editor.get('canvas');
    await canvas.trigger('mousedown', { button: 0, shiftKey: true, clientX: 310, clientY: 210 });
    await canvas.trigger('mouseup');
    await flushPromises();
    expect((editor.emitted('draft-changed')!.at(-1)![0] as RowData).turretOffsets).toEqual([30, 20, 30, -20]);
    editor.get('.editor-window').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    await flushPromises();
    expect((editor.emitted('draft-changed')!.at(-1)![0] as RowData).turretOffsets).toEqual([]);
    editor.get('.editor-window').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await flushPromises();
    expect((editor.emitted('draft-changed')!.at(-1)![0] as RowData).turretOffsets).toEqual([30, 20, 30, -20]);
  });

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
  });

  it('renders the editor shell with close and save actions', () => {
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile', type: 'BALLISTIC' });
    const buttons = editor.findAll('button').map((button) => button.text());
    expect(buttons).toContain('关闭');
    expect(buttons).toContain('保存');
  });

  it('switches the weapon type through the type select', async () => {
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile', type: 'BALLISTIC' });
    const selects = editor.findAll('select');
    const typeSelect = selects.find((select) => select.findAll('option').some((option) => option.text() === 'ENERGY'));
    expect(typeSelect).toBeTruthy();
    await typeSelect!.setValue(JSON.stringify('ENERGY'));
    const last = editor.emitted('draft-changed')?.at(-1)?.[0] as Record<string, unknown>;
    expect(last.type).toBe('ENERGY');
  });

  it('switches a pulse draft to an allowed branch and records one canvas undo action', async () => {
    const editor = mountEditor({ id: 'railgun', specClass: 'pulse', type: 'ENERGY', custom: { _slot: 'keep' } });
    await editor.setProps({ editContext: { targetKey: 'weapon', baselineGeneration: 1, handoff: 'load' } });
    expect(editor.text()).toContain('pulse 在原版中无法正常处理');
    const type = editor.findAll('select')[0]!;
    expect(type.findAll('option').map((option) => option.text())).toEqual(['projectile', 'beam']);
    await type.setValue(JSON.stringify('beam'));
    await vi.waitFor(() =>
      expect(editor.emitted('draft-changed')?.at(-1)?.[0]).toMatchObject({
        specClass: 'beam',
        textureType: 'SMOOTH',
        custom: { _slot: 'keep' },
      }),
    );
    editor.get('.editor-window').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await vi.waitFor(() =>
      expect(editor.emitted('draft-changed')?.at(-1)?.[0]).toMatchObject({ specClass: 'pulse', custom: { _slot: 'keep' } }),
    );
    const count = editor.emitted('draft-changed')!.length;
    editor.get('.editor-window').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await editor.vm.$nextTick();
    expect(editor.emitted('draft-changed')).toHaveLength(count);
  });

  it('renders the weapon canvas and barrel structure for projectile weapons', () => {
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile', type: 'BALLISTIC' });
    expect(editor.find('canvas.editor-canvas').exists()).toBe(true);
  });

  it('numbers the inspector from one while edits still address the first barrel', async () => {
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile', turretOffsets: [1, 2], turretAngleOffsets: [0] });
    const first = editor.get('[data-inspector-target="turret-barrel-0"]');
    expect(first.text()).toContain('发射点 1');
    await first.trigger('click');
    expect(first.classes()).toContain('selected');
  });

  it.each(['projectile', 'beam'])('groups glow separately after sprites for a %s weapon', (specClass) => {
    const editor = mountEditor({ id: 'railgun', specClass });
    const sections = editor.findAll('.n-collapse-item-stub').map((section) => section.attributes('data-name'));
    const position = sections.indexOf('glow');
    expect(sections.slice(position - 1, position + 2)).toEqual(['hardpointSprites', 'glow', 'turretBarrels']);
    expect(editor.get('[data-name="glow"]').text()).toContain('glowColor');
    expect(editor.findAll('.color-picker-label').filter((label) => label.text() === 'glowColor')).toHaveLength(1);
    expect(editor.get('[aria-pressed]').attributes('aria-pressed')).toBe('false');
  });

  it('draws only the base by default and starts and stops glow on demand', async () => {
    const { recording, tint, frames, load, advance, images } = installGlowRuntime();
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile' }, { turretSprite: 'base', turretGlowSprite: 'glow' });
    await load();
    expect(frames.size).toBe(0);
    expect(tint.getImageData).toHaveBeenCalledTimes(0);
    expect(recording.calls('drawImage').every((draw) => draw.args[0] === images[0])).toBe(true);
    recording.ops.length = 0;
    const toggle = editor.get('[aria-pressed]');
    await toggle.trigger('click');
    expect(toggle.attributes('aria-pressed')).toBe('true');
    expect(frames.size).toBe(1);
    expect(recording.calls('drawImage')).toHaveLength(16);
    expect(
      recording
        .calls('drawImage')
        .slice(1, 13)
        .map((draw) => draw.alpha),
    ).toEqual(Array(12).fill(0.2));
    expect(
      recording
        .calls('drawImage')
        .slice(13)
        .map((draw) => draw.alpha),
    ).toEqual(Array(3).fill(0.25));
    recording.ops.length = 0;
    advance(16);
    expect(frames.size).toBe(1);
    expect(recording.calls('drawImage')).toHaveLength(16);
    recording.ops.length = 0;
    await toggle.trigger('click');
    expect(toggle.attributes('aria-pressed')).toBe('false');
    expect(frames.size).toBe(0);
    expect(recording.calls('drawImage').map((draw) => draw.args[0])).toEqual([images[0]]);
    expect(tint.getImageData).toHaveBeenCalledOnce();
    expect(editor.emitted('draft-changed')).toBeUndefined();
  });

  it('stops at zero alpha and resumes on color edits and undo while keeping the toggle enabled', async () => {
    const { recording, tint, frames, load } = installGlowRuntime();
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile', glowColor: [100, 200, 50, 128] }, { turretGlowSprite: 'glow' });
    await editor.setProps({ editContext: { targetKey: 'weapon', baselineGeneration: 1, handoff: 'load' } });
    await load();
    await editor.get('[aria-pressed]').trigger('click');
    recording.ops.length = 0;
    tint.getImageData.mockClear();
    const color = editor.get('[data-name="glow"] .color-picker-text-input');
    await color.setValue('[100, 200, 50, 0]');
    await color.trigger('keyup.enter');
    expect(frames.size).toBe(0);
    expect(recording.calls('drawImage')).toHaveLength(0);
    expect(tint.getImageData).toHaveBeenCalledTimes(0);
    expect(editor.get('[aria-pressed]').attributes('aria-pressed')).toBe('true');
    const window = editor.get('.editor-window');
    window.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await flushPromises();
    expect(frames.size).toBe(1);
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({ glowColor: [100, 200, 50, 128] });
    window.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    await flushPromises();
    expect(frames.size).toBe(0);
    recording.ops.length = 0;
    await color.setValue('[100, 200, 50, 64]');
    await color.trigger('keyup.enter');
    expect(frames.size).toBe(1);
    const draws = recording.calls('drawImage');
    expect(draws.slice(0, 12).map((draw) => draw.alpha)).toEqual(Array(12).fill(64 / 1275));
    expect(draws.slice(12).map((draw) => draw.alpha)).toEqual(Array(3).fill(64 / 1020));
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({ glowColor: [100, 200, 50, 64] });
    expect(tint.getImageData).toHaveBeenCalledTimes(0);
  });

  it('follows the current view and loaded resources and releases the preview on close', async () => {
    const { frames, load, images, tint } = installGlowRuntime();
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile' }, { turretGlowSprite: 'glow' });
    await editor.get('[aria-pressed]').trigger('click');
    expect(frames.size).toBe(0);
    expect(tint.getImageData).toHaveBeenCalledTimes(0);
    await load();
    expect(frames.size).toBe(1);
    await editor
      .findAll('button')
      .find((button) => button.text().startsWith('固定视图'))!
      .trigger('click');
    expect(frames.size).toBe(0);
    expect(editor.get('[aria-pressed]').attributes('aria-pressed')).toBe('true');
    await editor.setProps({ spriteData: { hardpointGlowSprite: 'replacement' } });
    expect(frames.size).toBe(0);
    expect(images[0]!.onload).toBeNull();
    await load();
    expect(frames.size).toBe(1);
    await editor.setProps({ spriteData: {} });
    expect(frames.size).toBe(0);
    expect(images.every((image) => image.onload === null)).toBe(true);
    await editor.setProps({ spriteData: { hardpointGlowSprite: 'pending' } });
    await editor.get('[aria-pressed]').trigger('click');
    await load();
    expect(frames.size).toBe(0);
    await editor.get('[aria-pressed]').trigger('click');
    expect(frames.size).toBe(1);
    wrapper!.unmount();
    wrapper = null;
    expect(frames.size).toBe(0);
    expect(images.every((image) => image.onload === null)).toBe(true);
    const reopened = mountEditor({ id: 'railgun', specClass: 'projectile' }, { turretGlowSprite: 'glow' });
    await load();
    expect(reopened.get('[aria-pressed]').attributes('aria-pressed')).toBe('false');
    expect(frames.size).toBe(0);
  });

  it('retains preview selection through external content, save handoff and theme changes', async () => {
    const { frames, load } = installGlowRuntime();
    const weapon = { id: 'railgun', specClass: 'projectile', glowColor: [100, 200, 50, 128] };
    const editor = mountEditor(weapon, { turretGlowSprite: 'glow' });
    await load();
    await editor.get('[aria-pressed]').trigger('click');
    await editor.setProps({
      weapon: { ...weapon, glowColor: [100, 200, 50, 0] },
      editContext: { targetKey: 'weapon', baselineGeneration: 1, handoff: 'load' },
    });
    expect(frames.size).toBe(0);
    expect(editor.get('[aria-pressed]').attributes('aria-pressed')).toBe('true');
    await editor.setProps({ weapon, editContext: { targetKey: 'weapon', baselineGeneration: 2, handoff: 'save' } });
    expect(frames.size).toBe(1);
    useSettingsStore().setTheme('dark');
    await editor.vm.$nextTick();
    expect(editor.get('[aria-pressed]').attributes('aria-pressed')).toBe('true');
    expect(frames.size).toBe(1);
    expect(editor.emitted('draft-changed')).toBeUndefined();
  });

  it('delivers a detached fire-preview snapshot after committing active color input', async () => {
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile', unknown: { value: 7 } }, {}, true);
    await editor.get('[data-name="glow"] .color-picker-text-input').setValue('[100, 200, 50, 128]');
    await editor
      .findAll('button')
      .find((button) => button.text() === '发射预览')!
      .trigger('click');
    await flushPromises();
    const snapshot = editor.emitted('preview')!.at(-1)![0] as RowData;
    expect(snapshot).toMatchObject({ glowColor: [100, 200, 50, 128], unknown: { value: 7 } });
    await editor.get('[data-name="glow"] .color-picker-text-input').setValue('[1, 2, 3, 255]');
    await editor.get('[aria-pressed]').trigger('click');
    await flushPromises();
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({ glowColor: [1, 2, 3, 255] });
    expect(snapshot.glowColor).toEqual([100, 200, 50, 128]);
  });

  it('commits pending color input before enabling the preview', async () => {
    const { frames, tint, load } = installGlowRuntime();
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile' }, { turretGlowSprite: 'glow' }, true);
    await load();
    await editor.get('[data-name="glow"] .color-picker-text-input').setValue('[100, 200, 50, 0]');
    await editor.get('[aria-pressed]').trigger('click');
    await flushPromises();
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({ glowColor: [100, 200, 50, 0] });
    expect(editor.get('[aria-pressed]').attributes('aria-pressed')).toBe('true');
    expect(frames.size).toBe(0);
    expect(tint.getImageData).toHaveBeenCalledTimes(0);
  });

  it('preserves the draft and undo history when the theme changes', async () => {
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile', type: 'BALLISTIC' });
    await editor.setProps({ editContext: { targetKey: 'weapon', baselineGeneration: 1, handoff: 'load' } });
    const typeSelect = editor.findAll('select').find((select) => select.findAll('option').some((option) => option.text() === 'ENERGY'))!;
    await typeSelect.setValue(JSON.stringify('ENERGY'));
    const changes = editor.emitted('draft-changed')!.length;
    useSettingsStore().setTheme('dark');
    useSettingsStore().setAccent('orange');
    await editor.vm.$nextTick();
    expect(editor.emitted('draft-changed')).toHaveLength(changes);
    expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({ type: 'ENERGY' });
    editor.get('.editor-window').element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await vi.waitFor(() => expect(editor.emitted('draft-changed')!.at(-1)![0]).toMatchObject({ type: 'BALLISTIC' }));
  });

  it('shows the beam color fields for beam specs', () => {
    const editor = mountEditor({ id: 'laser', specClass: 'beam', type: 'ENERGY', 'beam speed': 1 });
    expect(editor.html()).toContain('fringeColor');
  });
});
