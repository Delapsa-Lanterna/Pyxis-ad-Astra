import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RowData } from '@/shared/types';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { editorUiStubs } from '@/test/ui-stubs';
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

function mountEditor(weapon: RowData, spriteData: Record<string, string> = {}) {
  wrapper = mount(WeaponEditor, {
    props: {
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
    },
    global: { stubs: editorUiStubs },
    attachTo: document.body,
  });
  return wrapper!;
}

describe('WeaponEditor', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore({
      theme: 'light',
      accent: 'blue',
      customAccent: '#2563eb',
      historyLimit: 20,
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

  it('animates a loaded glow and releases its frame and images on replacement and unmount', async () => {
    const images: Array<{ onload: (() => void) | null }> = [];
    vi.stubGlobal(
      'Image',
      class {
        width = 2;
        height = 2;
        onload: (() => void) | null = null;
        constructor() {
          images.push(this);
        }
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const request = vi.fn(() => 23);
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const editor = mountEditor({ id: 'railgun', specClass: 'projectile' }, { turretGlowSprite: 'glow' });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    await editor.setProps({ spriteData: {} });
    expect(cancel).toHaveBeenCalledWith(23);
    expect(images.every((image) => image.onload === null)).toBe(true);
    request.mockClear();
    await editor.setProps({ spriteData: { turretGlowSprite: 'replacement' } });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    editor.unmount();
    wrapper = null;
    expect(cancel).toHaveBeenCalledWith(23);
    expect(images.every((image) => image.onload === null)).toBe(true);
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
