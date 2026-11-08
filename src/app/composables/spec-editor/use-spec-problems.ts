import { inject, onScopeDispose, provide, type InjectionKey } from 'vue';
import type { FieldInputs } from '@/shared/runtime/field-inputs';
import { useFieldInputs, createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import { createEditorProblems } from '@/shared/runtime/editor-problems';
import { AppError } from '@/shared/lib/errors';
import type { FieldProblem } from '@/shared/types';

export const specProblemsKey: InjectionKey<ReturnType<typeof createSpecProblems>> = Symbol('spec-problems');
export function createSpecProblems(inputs: FieldInputs | null, validate?: () => FieldProblem[]) {
  const problems = createEditorProblems(inputs ?? createFieldInputs(), validate, Boolean(validate));
  return {
    ...problems,
    mapSaveError(error: unknown) {
      if (!(error instanceof AppError && ['spec-validation', 'commit-field-inputs'].includes(error.action ?? '')))
        problems.recordFailure(error);
      return new AppError('Spec 保存失败', {
        cause: error,
        action: error instanceof AppError ? error.action : undefined,
        userMessage: '请先解决顶部错误后再保存',
      });
    },
  };
}
export function useSpecProblems(read: () => FieldProblem[]) {
  const inherited = inject(specProblemsKey, null);
  const problems = inherited ?? createSpecProblems(useFieldInputs());
  provide(specProblemsKey, problems);
  provideFieldInputs(problems.inputs);
  if (!inherited) onScopeDispose(problems.register(read, true));
  else onScopeDispose(problems.register(() => read().filter((issue) => issue.severity === 'warning')));
  return problems;
}
