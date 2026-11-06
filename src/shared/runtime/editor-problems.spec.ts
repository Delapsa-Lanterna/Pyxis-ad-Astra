import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createFieldInputs } from './field-inputs';
import { createEditorProblems } from './editor-problems';
import { AppError } from '@/shared/lib/errors';
import EditorProblems from '@/shared/ui/EditorProblems.vue';

describe('shared editor problems', () => {
  it('prioritizes raw input, deduplicates issues and retains recoverable failures', () => {
    const raw = ref('invalid');
    const fields = createFieldInputs();
    fields.register({
      key: 'value',
      label: 'Value',
      dirty: ref(true),
      validate: () => raw.value || null,
      commit: () => null,
      focus: vi.fn(),
      cancel: vi.fn(),
    });
    const issue = { severity: 'warning' as const, code: 'sample.warning', path: 'value', message: 'Warning' };
    const problems = createEditorProblems(fields, () => [issue, issue]);
    expect(problems.issues.value).toMatchObject([{ code: 'field.input_invalid' }]);
    raw.value = '';
    expect(problems.issues.value).toEqual([issue]);
    problems.recordFailure(new AppError('Denied', { code: 'io.denied' }));
    expect(problems.issues.value).toHaveLength(2);
    problems.reveal();
    problems.reveal();
    expect(problems.revealRevision.value).toBe(2);
    problems.clearFailure();
    expect(problems.issues.value).toEqual([issue]);
    fields.release();
  });
  it('presents complete error and warning counts in severity order', () => {
    const issues = [
      { severity: 'warning' as const, code: 'w', path: 'one', message: 'Warning' },
      { severity: 'error' as const, code: 'e', path: 'two', message: 'Error' },
    ];
    const wrapper = mount(EditorProblems, { props: { issues } });
    expect(wrapper.findAll('section').map((s) => s.attributes('role'))).toEqual(['alert', 'status']);
    expect(wrapper.findAll('strong').map((s) => s.text())).toEqual(['无法保存 (1)', '保存前请确认 (1)']);
    expect(wrapper.findAll('li').map((s) => s.text())).toEqual(['Error', 'Warning']);
    wrapper.unmount();
  });
});
