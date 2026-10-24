import { computed, inject, onScopeDispose, provide, ref, type InjectionKey } from 'vue';
import type { FieldInputs } from '@/shared/runtime/field-inputs';
import { useFieldInputs, createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import { AppError, errorDiagnosticOf, formatError } from '@/shared/lib/errors';
import type { SpecIssue } from '@/domain/spec-editor/spec-validation';

export const specProblemsKey: InjectionKey<ReturnType<typeof createSpecProblems>> = Symbol('spec-problems');
export function createSpecProblems(inputs: FieldInputs | null, validate: () => SpecIssue[] = () => []) {
  const fields = inputs ?? createFieldInputs(),
    failure = ref<SpecIssue | null>(null);
  fields.registerDocumentValidation(validate);
  const issues = computed<SpecIssue[]>((previous) => {
    const raw = fields.errors.value.map((error): SpecIssue => ({
      severity: 'error',
      code: 'field.input_invalid',
      path: error.path ?? error.key,
      message: `${error.label}（${error.path ?? error.key}）：${error.message}`,
    }));
    const next = [
      ...new Map(
        fields.documentProblems.value
          .filter((item) => !raw.some((error) => error.path === item.path))
          .concat(raw, failure.value ? [failure.value] : [])
          .map((item) => [`${item.code}:${item.path}`, item]),
      ).values(),
    ];
    return previous &&
      previous.length === next.length &&
      previous.every(
        (issue, index) =>
          issue.severity === next[index]!.severity &&
          issue.code === next[index]!.code &&
          issue.path === next[index]!.path &&
          issue.message === next[index]!.message,
      )
      ? previous
      : next;
  });
  return {
    issues,
    inputs: fields,
    clearFailure: () => {
      failure.value = null;
    },
    register: fields.registerDocumentValidation,
    mapSaveError(error: unknown) {
      if (!(error instanceof AppError && ['spec-validation', 'commit-field-inputs'].includes(error.action ?? ''))) {
        const diagnostic = errorDiagnosticOf(error);
        failure.value = {
          severity: 'error',
          code: diagnostic.code,
          path: diagnostic.location?.path ?? '保存',
          message: formatError(error),
        };
      }
      return new AppError('Spec 保存失败', {
        cause: error,
        action: error instanceof AppError ? error.action : undefined,
        userMessage: '请先解决顶部错误后再保存',
      });
    },
  };
}
export function useSpecProblems(read: () => SpecIssue[]) {
  const inherited = inject(specProblemsKey, null);
  const problems = inherited ?? createSpecProblems(useFieldInputs());
  provide(specProblemsKey, problems);
  provideFieldInputs(problems.inputs);
  if (!inherited) onScopeDispose(problems.register(read));
  else onScopeDispose(problems.register(() => read().filter((issue) => issue.severity === 'warning')));
  return problems;
}
