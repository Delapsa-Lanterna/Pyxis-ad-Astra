import type { ProjectManifest, FeedbackNotice, GameScanWarning, ModOpeningFailure } from '@/shared/types';
import { errorDiagnosticOf, extractFileReferenceFromError, formatError } from '@/shared/lib/errors';
import { pathBelongsToRoot } from '@/shared/lib/paths';

export function scanWarningNotice(warning: GameScanWarning): FeedbackNotice {
  const target = warning.editTarget;
  return {
    userMessage: `${formatError(warning)} (${warning.path})`,
    diagnostic: {
      ...warning,
      fileTarget: target ? { ...target, mode: 'recovery', sessionId: null } : undefined,
    },
  };
}

export function formatLoadWarnings(loaded: ProjectManifest): FeedbackNotice[] {
  return loaded.warnings.map((warning) => {
    const notice = scanWarningNotice(warning);
    if (notice.diagnostic.fileTarget && pathBelongsToRoot(notice.diagnostic.fileTarget.path, loaded.modRoot))
      notice.diagnostic.fileTarget = {
        ...notice.diagnostic.fileTarget,
        modRoot: loaded.modRoot,
        mode: 'session',
        sessionId: loaded.sessionId,
      };
    return notice;
  });
}

export function modOpeningFailureNotice(failure: ModOpeningFailure): FeedbackNotice {
  return {
    userMessage: failure.message,
    diagnostic: {
      ...failure.diagnostic,
      location: failure.file
        ? { path: failure.file.path, line: failure.file.line ?? null, column: failure.file.column ?? null }
        : failure.diagnostic.location,
      fileTarget: failure.file ? { mode: 'recovery', sessionId: null, modRoot: failure.modRoot, path: failure.file.path } : undefined,
    },
  };
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
