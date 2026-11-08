import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import { createFieldInputs } from './field-inputs';
import { createEditorProblems } from './editor-problems';
import { AppError } from '@/shared/lib/errors';
import EditorProblems from '@/shared/ui/EditorProblems.vue';

describe('shared editor problems', () => {
  it('requires explicit ownership before delegating complete document checks', () => {
    const fields = createFieldInputs();
    const supplemental = fields.registerDocumentValidation(() => []);
    expect(fields.hasCompleteDocumentValidation.value).toBe(false);
    const complete = fields.registerDocumentValidation(() => [], true);
    expect(fields.hasCompleteDocumentValidation.value).toBe(true);
    complete();
    expect(fields.hasCompleteDocumentValidation.value).toBe(false);
    supplemental();
    fields.release();
  });
  it('keeps identical field codes in different physical files', () => {
    const fields = createFieldInputs();
    const issues = ['a.ship', 'b.ship'].map((file) => ({
      severity: 'error' as const,
      code: 'config.shape_invalid',
      path: 'width',
      message: 'Width',
      location: { path: 'M:/sample/' + file, field: 'width', line: null, column: null },
    }));
    const problems = createEditorProblems(fields, () => issues);
    expect(problems.issues.value).toEqual(issues);
    fields.release();
  });
  it('retains every field returned through a wrapped backend failure', () => {
    const fields = createFieldInputs();
    const issues = ['width', 'height'].map((path) => ({ severity: 'error' as const, code: 'config.shape_invalid', path, message: path }));
    const problems = createEditorProblems(fields);
    problems.recordFailure(new AppError('Rejected', { cause: { code: 'config.shape_invalid', message: 'Rejected', issues } }));
    expect(problems.issues.value).toEqual(issues);
    fields.release();
  });
  it('deduplicates the physical field identity while retaining independent rules', () => {
    const fields = createFieldInputs();
    const issue = {
      severity: 'warning' as const,
      code: 'rule.one',
      path: 'width',
      message: 'Width',
      location: { path: 'M:/mod/a.ship', field: 'width', line: null, column: null },
    };
    const same = { ...issue, path: '["record","width"]', location: { ...issue.location, path: 'm:\\mod\\a.ship' } };
    const independent = { ...issue, code: 'rule.two' };
    const problems = createEditorProblems(fields, () => [issue, same, independent]);
    expect(problems.issues.value).toEqual([same, independent]);
    fields.release();
  });
  it('keeps the raw field error ahead of a retained failure for that same CSV cell', () => {
    const fields = createFieldInputs();
    const raw = ref(false),
      path = JSON.stringify(['source-record', 'hitpoints']);
    fields.register({
      key: 'stable-cell',
      path,
      label: 'Hull',
      dirty: raw,
      validate: () => (raw.value ? 'Raw invalid' : null),
      commit: () => null,
      cancel: () => {},
      focus: () => {},
    });
    const problems = createEditorProblems(fields);
    problems.recordFailure(
      new AppError('Invalid field', {
        code: 'csv.value_invalid',
        location: { path: 'M:/mod/data/hulls/ship_data.csv', rowKey: 'ships:row:4', field: 'hitpoints', line: null, column: null },
      }),
      path,
    );
    expect(problems.issues.value).toHaveLength(1);
    raw.value = true;
    expect(problems.issues.value).toMatchObject([{ code: 'field.input_invalid', path }]);
    expect(problems.issues.value).toHaveLength(1);
    fields.release();
  });
  it('keeps the source file and exact field location when recording a save failure', () => {
    const fields = createFieldInputs();
    const problems = createEditorProblems(fields);
    expect(fields.hasCompleteDocumentValidation.value).toBe(false);
    const location = { path: 'M:/mod/data/variants/demo.variant', field: 'weaponGroups[0]["weapons"]', line: null, column: null };
    problems.recordFailure(new AppError('Save denied', { cause: { code: 'config.shape_invalid', message: 'Invalid field', location } }));
    expect(problems.issues.value).toMatchObject([{ code: 'config.shape_invalid', path: location.field, location }]);
    expect(problems.issues.value[0]!.message).toContain(location.path);
    expect(problems.issues.value[0]!.message).toContain(location.field);
    fields.release();
  });
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
    expect(problems.issues.value).toMatchObject([{ code: 'field.input_invalid' }, { code: 'sample.warning' }]);
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
  it('presents complete error and warning counts in severity order', async () => {
    const issues = [
      { severity: 'warning' as const, code: 'w', path: 'one', message: 'Warning' },
      { severity: 'error' as const, code: 'e', path: 'two', message: 'Error' },
    ];
    const wrapper = mount(EditorProblems, { props: { issues } });
    expect(wrapper.findAll('section').map((s) => s.attributes('role'))).toEqual(['alert', 'status']);
    expect(wrapper.findAll('strong').map((s) => s.text())).toEqual(['无法保存 (1)', '保存前请确认 (1)']);
    expect(wrapper.findAll('li').map((s) => s.text())).toEqual(['Error', 'Warning']);
    await wrapper.get('[role="button"]').trigger('click');
    await wrapper.findAll('[role="button"]')[1]!.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('locate')).toEqual([[issues[1]], [issues[0]]]);
    wrapper.unmount();
  });
});
