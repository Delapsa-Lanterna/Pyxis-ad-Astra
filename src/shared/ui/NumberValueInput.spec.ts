import { beginSavedWrite } from '@/test/unit/project-changes';
import { provideFieldInputs } from '@/shared/runtime/field-inputs';
import { flushPromises, mount } from '@vue/test-utils';
import { h } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NInputNumber } from 'naive-ui/es/input-number';
import { NButton } from 'naive-ui/es/button';
import NumberValueInput from './NumberValueInput.vue';
import { useEditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { applySchemaFieldUpdate } from '@/domain/schema/schema-values';
import type { RowData } from '@/shared/types';

let wrapper: ReturnType<typeof mount>;
afterEach(() => wrapper?.unmount());

async function harness(
  clearAction: 'remove' | 'required' = 'remove',
  integer = false,
  options: { step?: number; min?: number; max?: number; disabled?: boolean; showButton?: boolean } = {},
) {
  let session!: ReturnType<typeof useEditTargetDraftSession<RowData, string, null>>;
  const save = vi.fn(async (target: string, value: RowData) => ({ target, value, baseVersions: [], meta: null }));
  wrapper = mount(
    {
      setup() {
        session = useEditTargetDraftSession<RowData, string, null>({
          beginSave: beginSavedWrite,
          emptyValue: {},
          targetKey: (target) => target,
          load: (target) => ({ target, value: { count: 4 }, baseVersions: [], meta: null }),
          save,
        });
        provideFieldInputs(session.inputs);
        return () =>
          h(NumberValueInput, {
            value: session.draftValue.value.count,
            inputKey: 'count',
            label: 'Count',
            integer,
            clearAction,
            ...options,
            'onUpdate:value': (value) =>
              session.setDraft(applySchemaFieldUpdate(session.draftValue.value, 'count', { kind: 'set', value })),
            onRemove: () => session.setDraft(applySchemaFieldUpdate(session.draftValue.value, 'count', { kind: 'remove' })),
          });
      },
    },
    { global: { components: { 'n-input-number': NInputNumber, NButton } }, attachTo: document.body },
  );
  await session.loadTarget('one');
  await flushPromises();
  return { session, save };
}

describe('Smart numeric input with real Naive UI', () => {
  it('keeps disabled and hidden button states', async () => {
    const { session } = await harness('remove', false, { disabled: true });
    expect(wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined)).toBe(true);
    await wrapper.get('[aria-label="增加"]').trigger('click', { shiftKey: true });
    expect(session.draftValue.value.count).toBe(4);
    wrapper.unmount();
    await harness('remove', false, { showButton: false });
    expect(wrapper.findAll('button')).toHaveLength(0);
  });
  it.each([
    [false, false, 5],
    [true, false, 9],
    [false, true, 4.5],
    [true, true, 54],
  ])('applies Shift=%s and Ctrl=%s to both buttons and saves the result', async (shiftKey, ctrlKey, expected) => {
    const { session, save } = await harness();
    await wrapper.get('[aria-label="增加"]').trigger('click', { shiftKey, ctrlKey });
    expect(session.draftValue.value.count).toBe(expected);
    await session.saveDraft();
    expect(save).toHaveBeenCalledWith('one', { count: expected }, [], expect.any(Object), undefined);
    await wrapper.get('[aria-label="减少"]').trigger('click', { shiftKey, ctrlKey });
    expect(session.draftValue.value.count).toBe(4);
  });
  it.each([
    [1, 1],
    [3, 2],
  ])('rounds half of integer step %s to %s', async (step, offset) => {
    const { session } = await harness('required', true, { step });
    await wrapper.get('[aria-label="增加"]').trigger('click', { ctrlKey: true });
    expect(session.draftValue.value.count).toBe(4 + offset);
    await wrapper.get('[aria-label="减少"]').trigger('click', { ctrlKey: true });
    expect(session.draftValue.value.count).toBe(4);
  });
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('clamps overshooting steps at both boundaries with Shift=%s and Ctrl=%s', async (shiftKey, ctrlKey) => {
    const { session } = await harness('remove', false, { min: 3, max: 5, step: 8 });
    await wrapper.get('[aria-label="增加"]').trigger('click', { shiftKey, ctrlKey });
    expect(session.draftValue.value.count).toBe(5);
    expect(wrapper.get('[aria-label="增加"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[aria-label="减少"]').trigger('click', { shiftKey, ctrlKey });
    expect(session.draftValue.value.count).toBe(3);
    expect(wrapper.get('[aria-label="减少"]').attributes('disabled')).toBeDefined();
  });
  it('uses pending raw input, preserves decimal precision and retains invalid input on clicks', async () => {
    const { session } = await harness('remove', false, { step: 0.2 });
    await wrapper.get('input').setValue('0.2');
    await wrapper.get('[aria-label="增加"]').trigger('click', { ctrlKey: true });
    expect(session.draftValue.value.count).toBe(0.3);
    await wrapper.get('input').setValue('1e');
    await wrapper.get('[aria-label="增加"]').trigger('click', { shiftKey: true });
    expect(session.draftValue.value.count).toBe(0.3);
    expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('1e');
    await expect(session.saveDraft()).rejects.toMatchObject({ action: 'commit-field-inputs' });
  });
  it.each(['-', '1e', '1.2.3'])('retains %s, participates in dirty and focuses the failed save', async (raw) => {
    const { session, save } = await harness();
    const input = wrapper.get('input');
    await input.setValue(raw);
    expect(session.draftValue.value.count).toBe(4);
    expect(session.dirty.value).toBe(true);
    await expect(session.saveDraft()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(document.activeElement).toBe(input.element);
    expect((input.element as HTMLInputElement).value).toBe(raw);
    expect(save).not.toHaveBeenCalled();
    await input.setValue('12.5');
    await session.saveDraft();
    expect(save).toHaveBeenCalledWith('one', { count: 12.5 }, [], expect.any(Object), undefined);
    expect(session.dirty.value).toBe(false);
  });
  it('removes an optional key on save and retains required empty input', async () => {
    const { session, save } = await harness();
    await wrapper.get('input').setValue('');
    await session.saveDraft();
    expect(save).toHaveBeenCalledWith('one', {}, [], expect.any(Object), undefined);
    wrapper.unmount();
    const required = await harness('required');
    await wrapper.get('input').setValue('');
    await expect(required.session.saveDraft()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(required.session.draftValue.value.count).toBe(4);
  });
  it('rejects fractional integers and restores cancelled raw input for an equal baseline', async () => {
    const { session } = await harness('required', true);
    await wrapper.get('input').setValue('1.5');
    await expect(session.saveDraft()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    session.resetDraft();
    await flushPromises();
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('4');
    expect(session.dirty.value).toBe(false);
  });
});
