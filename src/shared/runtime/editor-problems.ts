import { computed, ref } from 'vue';
import type { FieldInputs } from './field-inputs';
import type { FieldProblem } from '@/shared/types';
import { AppError, errorDiagnosticOf, formatError } from '@/shared/lib/errors';
import { normalizeFsPath } from '@/shared/lib/paths';

export function fieldProblemKey(issue: FieldProblem): string {
  return JSON.stringify([
    normalizeFsPath(issue.location?.path ?? ''),
    issue.location?.rowKey,
    issue.location?.field ?? issue.path,
    issue.code,
  ]);
}

export function createEditorProblems(fields: FieldInputs, validate?: () => FieldProblem[], complete = false) {
  const failure = ref<FieldProblem[]>([]);
  const revealRevision = ref(0);
  if (validate) fields.registerDocumentValidation(validate, complete);
  const issues = computed<FieldProblem[]>((previous) => {
    const raw = fields.errors.value.map((error): FieldProblem => ({
      severity: 'error',
      code: 'field.input_invalid',
      path: error.path ?? error.key,
      message: `${error.label} (${error.path ?? error.key}): ${error.message}`,
    }));
    const next = [
      ...new Map(
        raw
          .concat(fields.documentProblems.value, failure.value)
          .filter(
            (item) =>
              item.severity === 'warning' ||
              !['csv.value_invalid', 'config.shape_invalid', 'spec.field_invalid'].includes(item.code) ||
              !raw.some((error) => error.path === item.path),
          )
          .map((item) => [fieldProblemKey(item), item]),
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
      failure.value = [];
    },
    register: fields.registerDocumentValidation,
    recordFailure(error: unknown, path?: string) {
      const diagnostic = errorDiagnosticOf(error);
      const location = diagnostic.location;
      if (error instanceof AppError && error.issues) {
        failure.value = error.issues;
        return;
      }
      failure.value = [
        {
          severity: 'error',
          code: diagnostic.code,
          path: path ?? location?.field ?? location?.path ?? '保存',
          location,
          message: [formatError(error), location?.path, location?.field].filter(Boolean).join(' · '),
        },
      ];
    },
  };
}
