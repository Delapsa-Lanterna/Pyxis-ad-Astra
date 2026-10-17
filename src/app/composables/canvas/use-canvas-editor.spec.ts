import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import { deepClone } from '@/shared/lib/starsector';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref, shallowRef, type Ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useCanvasEditor } from './use-canvas-editor';
import { createCanvasState } from './use-canvas-state';
import { useEditorDocument } from '@/app/composables/editors/use-editor-document';
import { useCanvasViewport } from './use-canvas-viewport';
import type { EditContext, RowData } from '@/shared/types';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));

function mountCanvas() {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  installCanvas2DStub();
  let value!: Ref<RowData>;
  const source = ref<RowData>({ x: 0 }),
    context = ref<EditContext | null>({ targetKey: 'one', baselineGeneration: 1, handoff: 'load' });
  const inputs = createFieldInputs(ref('one')),
    state = createCanvasState<null>();
  const viewport = useCanvasViewport(shallowRef(null), 1, 10);
  let editor!: ReturnType<typeof useCanvasEditor<null>>;
  let document!: ReturnType<typeof useEditorDocument>;
  const onDraftMutated = vi.fn((draft: RowData) => {
    source.value = deepClone(draft);
  });
  const target = { kind: 'slot', i: 0, distance: 0 };
  const hooks: Parameters<typeof useCanvasEditor<null>>[0]['hooks'] = {
    targets: () => [target],
    radius: () => 5,
    deleteSelected: () => {},
    shortcuts: {},
    inspector: () => null,
    previewTakesOver: () => false,
    preview: () => null,
    draw: vi.fn(),
    begin: () => ({
      kind: 'slot',
      update: (input) => {
        value.value.x = input.point.x;
        if (state.mirrorMode.value) value.value.y = -input.point.x;
      },
    }),
  };
  const surface = defineComponent({
    setup() {
      document = useEditorDocument({
        source: () => source.value,
        normalize: (next) => next,
        context,
        publish: onDraftMutated,
        historyLimit: ref(250),
        draw: hooks.draw,
        reset: () => editor.reset(),
      });
      value = document.value;
      editor = useCanvasEditor({
        document,
        stageRef: shallowRef(null),
        windowRef: shallowRef(null),
        expandedSections: ref([]),
        viewport,
        state,
        hooks,
      });
      return () =>
        h('section', [
          h('input', {
            value: value.value.x,
            onFocusin: document.beginField,
            onFocusout: document.fieldBlur,
            onKeyup: document.fieldKey,
            onInput: (event: Event) =>
              document.change((draft) => {
                draft.x = Number((event.target as HTMLInputElement).value);
              }),
          }),
          h('canvas', { onMousedown: editor.onDown, onMousemove: editor.onMove, onMouseup: editor.onUp, onMouseleave: editor.onLeave }),
        ]);
    },
  });
  const wrapper = mount(
    {
      setup() {
        provideFieldInputs(inputs);
        return () => h(surface);
      },
    },
    { attachTo: window.document.body },
  );
  return { wrapper, onDraftMutated, value, source, context, inputs, state, editor, document, hooks, viewport };
}

describe('canvas pointer completion', () => {
  it('anchors Spec wheel navigation at the pointer without publishing a draft', () => {
    const { wrapper, editor, viewport, onDraftMutated } = mountCanvas();
    viewport.panBy(20, -10);
    const point = viewport.fromCanvas('ship', 80, 100);
    editor.onWheel(new WheelEvent('wheel', { deltaY: -1, clientX: 80, clientY: 100 }));
    const projected = viewport.toCanvas('ship', point.x, point.y);
    expect(projected.x).toBeCloseTo(80);
    expect(projected.y).toBeCloseTo(100);
    expect(onDraftMutated).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it.each(['mouseup', 'mouseleave'])('commits a drag once on %s', async (boundary) => {
    const { wrapper, onDraftMutated } = mountCanvas();
    const canvas = wrapper.find('canvas');
    await canvas.trigger('mousedown', { button: 0, offsetX: 0, offsetY: 0 });
    await canvas.trigger('mousemove', { clientX: 10, clientY: 0 });
    expect(onDraftMutated).not.toHaveBeenCalled();
    await canvas.trigger(boundary);
    expect(onDraftMutated).toHaveBeenCalledExactlyOnceWith({ x: 10 });
    await canvas.trigger('mouseup');
    await canvas.trigger('mouseleave');
    expect(onDraftMutated).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('keeps view-only panning outside the draft history', async () => {
    const { wrapper, onDraftMutated } = mountCanvas();
    const canvas = wrapper.find('canvas');
    await canvas.trigger('mousedown', { button: 2 });
    await canvas.trigger('mousemove', { offsetX: 10, offsetY: 0 });
    await canvas.trigger('mouseleave');
    expect(onDraftMutated).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe('canvas action and history lifecycle', () => {
  it('keeps pending input attached to its selection while the pointer moves', async () => {
    const { wrapper, inputs, state } = mountCanvas();
    const pending = ref(true);
    inputs.register({ key: 'number', label: 'Number', dirty: pending, commit: () => 'Incomplete', cancel: () => {}, focus: () => {} });
    state.select({ kind: 'slot', i: 1 });
    await wrapper.get('canvas').trigger('mousemove', { clientX: 5 });
    expect(state.selected.value).toBe(1);
    pending.value = false;
    await wrapper.get('canvas').trigger('mousemove', { clientX: 5 });
    expect(state.selected.value).toBe(0);
    wrapper.unmount();
  });
  it('preserves asynchronous action acceptance across saving and revokes it on baseline handoff and release', async () => {
    const { wrapper, document, context } = mountCanvas();
    const accepts = document.captureActionContext();
    context.value = { targetKey: 'renamed', baselineGeneration: 2, handoff: 'save' };
    await nextTick();
    expect(accepts()).toBe(true);
    context.value = { targetKey: 'renamed', baselineGeneration: 3, handoff: 'external' };
    await nextTick();
    expect(accepts()).toBe(false);
    const current = document.captureActionContext();
    wrapper.unmount();
    expect(current()).toBe(false);
  });
  it('groups continuous inspector typing, alternates with pointer history and retains history after local save', async () => {
    const { wrapper, document, value, context } = mountCanvas();
    const input = wrapper.get('input');
    input.element.focus();
    await input.setValue('1');
    await input.setValue('2');
    await input.trigger('keyup', { key: 'Enter' });
    expect(value.value.x).toBe(2);
    input.element.blur();
    const canvas = wrapper.get('canvas');
    await canvas.trigger('mousedown', { button: 0, clientX: 3 });
    await canvas.trigger('mouseup');
    await nextTick();
    expect(value.value.x).toBe(3);
    context.value = { targetKey: 'one', baselineGeneration: 2, handoff: 'save' };
    await nextTick();
    await document.undo();
    expect(value.value.x).toBe(2);
    await document.undo();
    expect(value.value.x).toBe(0);
    await document.redo();
    expect(value.value.x).toBe(2);
    wrapper.unmount();
  });
  it('finishes dragging at save capture and records mirror mutation once', async () => {
    const { wrapper, editor, document, value, inputs, state } = mountCanvas();
    state.toggleMirror();
    const canvas = wrapper.get('canvas');
    await canvas.trigger('mousedown', { button: 0, clientX: 5 });
    await nextTick();
    expect(editor.dragKind.value).toBe('slot');
    await inputs.commit();
    const submitted = deepClone(value.value);
    expect(submitted.x).toBe(5);
    expect(submitted.y).toBe(-5);
    expect(editor.dragKind.value).toBeNull();
    await canvas.trigger('mousemove', { offsetX: 8 });
    await canvas.trigger('mouseup');
    await document.undo();
    expect(value.value.x).toBe(0);
    await document.redo();
    expect(value.value.x).toBe(5);
    wrapper.unmount();
  });
  it('validates pending raw input before an action finalizer records history', async () => {
    const { wrapper, document, value, inputs } = mountCanvas();
    const input = wrapper.get('input');
    input.element.focus();
    await input.setValue('2');
    const pending = ref(true);
    const release = inputs.register({
      key: 'raw',
      label: 'Raw',
      dirty: pending,
      commit: () => 'Incomplete',
      cancel: () => {},
      focus: () => {},
    });
    await expect(inputs.commit()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    release();
    await inputs.commit();
    await document.undo();
    expect(value.value.x).toBe(0);
    wrapper.unmount();
  });
  it('clears selection, preview and both history stacks on an external baseline', async () => {
    const { wrapper, editor, document, value, source, context, state } = mountCanvas();
    await document.command((draft) => {
      draft.x = 5;
    });
    state.select({ kind: 'slot', i: 0 });
    source.value = { x: 90 };
    context.value = { targetKey: 'one', baselineGeneration: 2, handoff: 'external' };
    await nextTick();
    expect(value.value.x).toBe(90);
    expect(state.selected.value).toBeNull();
    expect(editor.dragKind.value).toBeNull();
    await document.undo();
    await document.redo();
    expect(value.value.x).toBe(90);
    wrapper.unmount();
  });
  it('completes a short pointer action released while inputs are committing', async () => {
    const { wrapper, value, inputs, document, onDraftMutated } = mountCanvas();
    const raw = ref(true);
    inputs.register({
      key: 'raw',
      label: 'Raw',
      dirty: raw,
      commit: () => {
        raw.value = false;
        return null;
      },
      cancel: () => {},
      focus: () => {},
    });
    const canvas = wrapper.get('canvas');
    canvas.element.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 4 }));
    canvas.element.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    await nextTick();
    await nextTick();
    await nextTick();
    expect(value.value.x).toBe(4);
    expect(onDraftMutated).toHaveBeenCalledOnce();
    await document.undo();
    expect(value.value.x).toBe(0);
    wrapper.unmount();
  });
});
