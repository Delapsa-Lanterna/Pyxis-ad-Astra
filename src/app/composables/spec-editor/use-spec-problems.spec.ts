import { describe, expect, it } from 'vitest';
import { computed, effectScope, ref } from 'vue';
import { createFieldInputs } from '@/shared/runtime/field-inputs';
import { AppError, formatError, errorDiagnosticOf } from '@/shared/lib/errors';
import { createSpecProblems } from './use-spec-problems';

describe('Spec problem ownership', () => {
  it('uses raw errors before model errors at the same field and deduplicates document issues', () => {
    const scope = effectScope();
    scope.run(() => {
      const inputs = createFieldInputs();
      const raw = ref('1e');
      inputs.register({
        key: 'stable/one',
        path: 'width',
        label: '宽度',
        dirty: computed(() => true),
        validate: () => (raw.value === '1e' ? '请输入完整有效数字' : null),
        commit: () => null,
        focus: () => {},
        cancel: () => {},
      });
      const issue = { severity: 'error' as const, code: 'spec.field_invalid', path: 'width', message: '模型错误' };
      const problems = createSpecProblems(inputs, () => [issue, issue]);
      expect(problems.issues.value).toMatchObject([{ code: 'field.input_invalid', path: 'width' }]);
      raw.value = '2';
      expect(problems.issues.value).toEqual([issue]);
      inputs.release();
      expect(problems.issues.value).toEqual([]);
    });
    scope.stop();
  });
  it('retains the actual failure diagnostic and exposes only the short save refusal in notifications', () => {
    const problems = createSpecProblems(createFieldInputs());
    const error = new AppError('写入失败', { code: 'io.denied', location: { path: 'M:/sample.ship', line: null, column: null } });
    const displayed = problems.mapSaveError(error);
    expect(formatError(displayed)).toBe('请先解决顶部错误后再保存');
    expect(errorDiagnosticOf(displayed).code).toBe('io.denied');
    expect(problems.issues.value).toMatchObject([{ severity: 'error', code: 'io.denied', path: 'M:/sample.ship', message: '写入失败' }]);
    problems.clearFailure();
    expect(problems.issues.value).toEqual([]);
  });
});
