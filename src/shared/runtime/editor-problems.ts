import { computed, ref } from 'vue';
import type { FieldInputs } from './field-inputs';
import type { FieldProblem } from '@/shared/types';
import { errorDiagnosticOf, formatError } from '@/shared/lib/errors';

export function createEditorProblems(fields: FieldInputs, validate: () => FieldProblem[] = () => []) {
  const failure = ref<FieldProblem | null>(null);
  const revealRevision = ref(0);
  fields.registerDocumentValidation(validate);
  const issues = computed<FieldProblem[]>((previous) => {
    const raw = fields.errors.value.map((error): FieldProblem => ({
      severity: 'error',
      code: 'field.input_invalid',
      path: error.path ?? error.key,
      message: `${error.label} (${error.path ?? error.key}): ${error.message}`,
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
    revealRevision,
    reveal: () => {
      revealRevision.value++;
    },
    clearFailure: () => {
      failure.value = null;
    },
    register: fields.registerDocumentValidation,
    recordFailure(error: unknown) {
      const diagnostic = errorDiagnosticOf(error);
      failure.value = { severity: 'error', code: diagnostic.code, path: diagnostic.location?.path ?? '保存', message: formatError(error) };
    },
  };
}
