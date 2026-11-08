import { computed, ref } from 'vue';
import type { FieldInputs } from './field-inputs';
import type { FieldProblem } from '@/shared/types';
import { errorDiagnosticOf, formatError } from '@/shared/lib/errors';

export function createEditorProblems(fields: FieldInputs, validate?: () => FieldProblem[]) {
  const failure = ref<FieldProblem | null>(null);
  const revealRevision = ref(0);
  if (validate) fields.registerDocumentValidation(validate);
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
          .concat(failure.value ? [failure.value] : [])
          .filter((item) => !raw.some((error) => error.path === item.path))
          .concat(raw)
          .map((item) => [`${item.code}:${item.location?.rowKey ?? ''}:${item.path}`, item]),
      ).values(),
    ];
    return previous &&
      previous.length === next.length &&
      previous.every(
        (issue, index) =>
          issue.severity === next[index]!.severity &&
          issue.code === next[index]!.code &&
          issue.path === next[index]!.path &&
          issue.location === next[index]!.location &&
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
    recordFailure(error: unknown, path?: string) {
      const diagnostic = errorDiagnosticOf(error);
      const location = diagnostic.location;
      failure.value = {
        severity: 'error',
        code: diagnostic.code,
        path: path ?? location?.field ?? location?.path ?? '保存',
        location,
        message: [formatError(error), location?.path, location?.field].filter(Boolean).join(' · '),
      };
    },
  };
}
