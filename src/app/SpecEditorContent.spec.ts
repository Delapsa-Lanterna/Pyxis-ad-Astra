import { installCanvas2DStub } from '@/test/unit/canvas-stub';
import { mount, flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { editorUiStubs } from '@/test/unit/ui-stubs';
import { createCanvasRecorder } from '@/test/unit/canvas-recorder';
import { normalizeShipSpec } from '@/domain/spec-editor/ship/spec-ship-editing';

import { entityTargetFixture } from '@/test/fixtures/entity-target';
const fileTarget = entityTargetFixture('ship', 'XY');
import type { RowData } from '@/shared/types/index';
import SpecEditorContent from './SpecEditorContent.vue';
import { createSpecProblems } from '@/app/composables/spec-editor/use-spec-problems';

const mocks = vi.hoisted(() => ({ createWindow: vi.fn() }));
vi.mock('@/app/composables/spec-editor/use-spec-editor-window-view-model', () => ({
  useSpecEditorWindowViewModel: () => mocks.createWindow(),
}));
vi.mock('@/app/composables/use-window-close-state', () => ({
  useWindowCloseState: () => null,
  useWindowCloseParticipant: () => ({ install: vi.fn(async () => {}), dispose: vi.fn() }),
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn(), warning: vi.fn() }) }));
vi.mock('@/app/composables/spec-editor/use-spec-editor-draft-images', () => ({
  useSpecEditorDraftImages: () => ({ value: ref(null), loading: ref(false), errorText: ref('') }),
}));
vi.mock('@/services/spec-ship-editor.service', () => ({ querySpecShipEditorImages: vi.fn(), querySpecShipEditorData: vi.fn() }));
vi.mock('@/services/spec-system-editor.service', () => ({ querySpecSystemEditorData: vi.fn() }));
vi.mock('@/windows/current.window', () => ({ closeCurrentWindow: vi.fn(async () => {}) }));
vi.mock('@/windows/spec-editor.window', () => ({
  openSpecProjectileEditorWindow: vi.fn(async () => {}),
}));
vi.mock('@/windows/window-context.window', () => ({
  useWindowContext: () =>
    computed(() => ({ identity: { sessionId: 's1', modRoot: 'M:/mod', id: 'XY', kind: 'ship' }, input: { starsectorRoot: null } })),
}));
vi.mock('@/app/composables/use-managed-window-requests', () => ({ useManagedWindowRequests: vi.fn() }));
let wrapper: ReturnType<typeof mount> | null = null;
beforeEach(() => {
  installCanvas2DStub();
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
});
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.restoreAllMocks();
});
function setupWindow(initial = true) {
  const source = normalizeShipSpec({ hullId: 'XY', hullName: 'Initial', center: [0, 0], shieldCenter: [0, 0] });
  const data = ref<{ kind: 'ship'; spec: RowData; target: typeof fileTarget } | null>(
      initial ? { kind: 'ship', target: fileTarget, spec: source } : null,
    ),
    dirty = ref(false),
    loading = ref(!initial);
  const context = ref({ targetKey: 'ship', baselineGeneration: 1, handoff: 'load' as 'load' | 'external' });
  const inputs = createFieldInputs(ref('ship'));
  const vm = {
    problems: createSpecProblems(inputs),
    currentTarget: ref({ id: 'XY', kind: 'ship', sessionId: 's1', modRoot: 'M:/mod' }),
    editorData: data,
    loading,
    contentReady: computed(() => data.value !== null),
    errorText: ref(''),
    weaponForEditor: ref({}),
    draftValue: computed(() => data.value?.spec ?? {}),
    shipSpriteForEditor: ref(''),
    draftDirty: dirty,
    editContext: context,
    draftSaving: ref(false),
    handoffLocked: ref(false),
    canSaveSpec: dirty,
    externalUpdateNotice: ref(''),
    missingEditorText: ref(''),
    initializeEditorWindow: vi.fn(async () => {}),
    disposeEditorWindow: vi.fn(),
    saveEditorData: vi.fn(),
    resetDraft: vi.fn(),
    loadPendingExternalSpec: vi.fn(),
    updateEditorDraft: (value: RowData) => {
      data.value = { kind: 'ship', target: fileTarget, spec: value };
      dirty.value = true;
    },
  };
  mocks.createWindow.mockImplementation(() => {
    provideFieldInputs(inputs);
    return vm;
  });
  const recording = createCanvasRecorder();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(recording.ctx);
  wrapper = mount(SpecEditorContent, { global: { stubs: editorUiStubs }, attachTo: document.body });
  return { vm, inputs, recording, source, wrapper };
}
describe('editor window refresh lifetime', () => {
  it('keeps the same editor, focus, viewport and working document while refreshing and after external acceptance', async () => {
    const { vm, inputs, recording, wrapper } = setupWindow();
    await flushPromises();
    const canvas = wrapper.get('canvas'),
      originalCanvas = canvas.element;
    await canvas.trigger('mousedown', { button: 2, clientX: 0, clientY: 0 });
    await canvas.trigger('mousemove', { clientX: 20, clientY: 15 });
    await canvas.trigger('mouseup');
    const input = wrapper.findAll('input').find((x) => (x.element as HTMLInputElement).value === 'Initial')!;
    input.element.focus();
    await input.setValue('Edited');
    const originalInput = input.element;
    await flushPromises();
    const latestDraw = recording.ops.findLastIndex((op) => op.op === 'clearRect');
    const markerPosition = recording.ops.slice(latestDraw).find((op) => op.op === 'moveTo')!.args;
    vm.loading.value = true;
    await flushPromises();
    expect(wrapper.get('canvas').element).toBe(originalCanvas);
    expect(wrapper.findAll('input').find((x) => x.element === originalInput)!.element).toBe(document.activeElement);
    expect((originalInput as HTMLInputElement).value).toBe('Edited');
    expect(wrapper.find('.editor-window-status').exists()).toBe(false);
    vm.loading.value = false;
    recording.ops.length = 0;
    inputs.cancel();
    vm.editorData.value = {
      kind: 'ship',
      target: fileTarget,
      spec: normalizeShipSpec({ ...vm.editorData.value!.spec, hullName: 'External' }),
    };
    vm.editContext.value = { targetKey: 'ship', baselineGeneration: 2, handoff: 'external' };
    await flushPromises();
    expect(wrapper.get('canvas').element).toBe(originalCanvas);
    expect(wrapper.findAll('input').some((x) => (x.element as HTMLInputElement).value === 'External')).toBe(true);
    expect(recording.calls('moveTo')[0]!.args).toEqual([7.5, 15.5]);
    expect(markerPosition).toEqual([7.5, 15.5]);
  });
  it('shows loading for the initial read and mounts the editor once content exists', async () => {
    const { vm, source, wrapper } = setupWindow(false);
    expect(wrapper.find('.editor-window-status').text()).toContain('正在加载');
    expect(wrapper.find('canvas').exists()).toBe(false);
    vm.editorData.value = { kind: 'ship', target: fileTarget, spec: source };
    await flushPromises();
    expect(wrapper.find('canvas').exists()).toBe(true);
    const canvas = wrapper.get('canvas').element;
    vm.loading.value = false;
    await flushPromises();
    expect(wrapper.get('canvas').element).toBe(canvas);
  });
});
