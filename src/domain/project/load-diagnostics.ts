import type { ProjectManifest, FeedbackNotice, GameScanWarning, ModOpeningFailure } from '@/shared/types';
import { errorDiagnosticOf, extractFileReferenceFromError, formatError } from '@/shared/lib/errors';
import { pathBelongsToRoot } from '@/shared/lib/paths';

export function scanWarningNotice(warning: GameScanWarning): FeedbackNotice {
  return { userMessage: `${formatError(warning)} (${warning.path})`, diagnostic: warning };
}

export function formatLoadWarnings(loaded: ProjectManifest): FeedbackNotice[] {
  return loaded.warnings.map(scanWarningNotice);
}

export function buildModOpeningFailure(modRoot: string, error: unknown): ModOpeningFailure {
  const diagnostic = errorDiagnosticOf(error);
  const reference = extractFileReferenceFromError(error);
  return {
    modRoot,
    message: formatError(error),
    diagnostic,
    file:
      reference && pathBelongsToRoot(reference.path, modRoot)
        ? { path: reference.path, line: reference.line, column: reference.column }
        : null,
  };
}
