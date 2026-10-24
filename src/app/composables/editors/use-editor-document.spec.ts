import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { h, nextTick, ref } from 'vue';
import { useEditorDocument } from './use-editor-document';
import { deepClone } from '@/shared/lib/starsector';
import type { EditContext, RowData } from '@/shared/types';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));
describe('editor committed snapshots', () => {
  it('groups field and gesture edits and keeps history correct after replay and external acceptance', async () => {
    const context = ref<EditContext>({ targetKey: 'one', baselineGeneration: 1, handoff: 'load' });
    const source = ref<RowData>({ text: 'A', nested: { value: 1 } });
    let editor!: ReturnType<typeof useEditorDocument>;
    const wrapper = mount({
      setup() {
        editor = useEditorDocument({ source: () => source.value, normalize: deepClone, context, historyLimit: ref(20), publish: vi.fn() });
        return () => h('input', { value: editor.value.value.text });
      },
    });
    try {
      const element = wrapper.get('input').element;
      editor.beginField({ target: element } as unknown as FocusEvent);
      editor.change((value) => {
        value.text = 'AB';
      });
      editor.change((value) => {
        value.text = 'ABC';
      });
      editor.finish();
      await editor.undo();
      expect(editor.value.value.text).toBe('A');
      await editor.redo();
      expect(editor.value.value.text).toBe('ABC');
      await editor.command((value) => {
        value.text = 'D';
      });
      await editor.undo();
      expect(editor.value.value.text).toBe('ABC');
      const complete = vi.fn();
      editor.beginGesture(complete);
      editor.change((value) => {
        value.text = 'E';
      });
      editor.change((value) => {
        value.text = 'F';
      });
      editor.finish();
      expect(complete).toHaveBeenCalledOnce();
      await editor.undo();
      expect(editor.value.value.text).toBe('ABC');
      source.value = { text: 'external' };
      context.value = { targetKey: 'one', baselineGeneration: 2, handoff: 'external' };
      await nextTick();
      await editor.command((value) => {
        value.text = 'next';
      });
      await editor.undo();
      expect(editor.value.value.text).toBe('external');
      expect(source.value).toEqual({ text: 'external' });
    } finally {
      wrapper.unmount();
    }
  });
});
