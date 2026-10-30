import type { ErrorDiagnostic, ErrorLocation, FeedbackNotice, FeedbackFileTarget, FileReference } from '@/shared/types';
import { commandErrorCopy } from '@/shared/lib/error-messages';
export type { FileReference } from '@/shared/types';

export class AppError extends Error {
  readonly action?: string;
  readonly code?: string;
  readonly command?: string;
  readonly location: ErrorLocation | null;
  override readonly cause?: unknown;
  readonly userMessage?: string;
  readonly fileTarget?: FeedbackFileTarget;

  constructor(
    message: string,
    options: {
      action?: string;
      command?: string;
      code?: string;
      location?: ErrorLocation | null;
      cause?: unknown;
      userMessage?: string;
      fileTarget?: FeedbackFileTarget;
    } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.action = options.action;
    this.command = options.command;
    this.code = options.code;
    this.location = options.location ?? null;
    this.cause = options.cause;
    this.userMessage = options.userMessage;
    this.fileTarget = options.fileTarget;
  }
}

export function withCause(message: string, cause: unknown, action?: string): AppError {
  return new AppError(message, { action, cause });
}

export class MediaReadError extends AppError {
  constructor(readonly failures: ErrorDiagnostic[]) {
    super(`图片读取失败：${failures.length} 项`, { code: 'resource.read_failed', command: 'query_resource_data_urls' });
  }
}

function wireDiagnostic(error: unknown): ErrorDiagnostic | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as Partial<ErrorDiagnostic>;
  if (typeof candidate.code !== 'string' || typeof candidate.message !== 'string') return null;
  return { code: candidate.code, message: candidate.message, location: candidate.location ?? null, fileTarget: candidate.fileTarget };
}

export function errorDiagnosticOf(error: unknown): ErrorDiagnostic {
  if (error instanceof AppError) {
    const source = error.cause === undefined ? null : errorDiagnosticOf(error.cause);
    return {
      code: error.code ?? source?.code ?? 'ui.action_failed',
      message: source?.message ?? error.message,
      location: error.location ?? source?.location ?? null,
      fileTarget: error.fileTarget ?? source?.fileTarget,
    };
  }
  const wire = wireDiagnostic(error);
  if (wire) return wire;
  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error',
    location: null,
  };
}

export function commandErrorCode(error: unknown): string | null {
  const code = errorDiagnosticOf(error).code;
  return code === 'unknown' ? null : code;
}

export function errorCodeOf(error: unknown): string {
  return errorDiagnosticOf(error).code;
}

export function errorMessageOf(error: unknown): string {
  return errorDiagnosticOf(error).message;
}

function joinErrorMessages(context: string, source: string): string {
  return !source || context.includes(source) ? context : `${context}：${source}`;
}

export function formatError(error: unknown): string {
  if (error instanceof AppError && error.userMessage) return error.userMessage;
  if (error instanceof AppError && error.cause !== undefined) {
    const source = formatError(error.cause);
    return error.command ? source : joinErrorMessages(error.message, source);
  }
  const diagnostic = errorDiagnosticOf(error);
  return commandErrorCopy(diagnostic.code) ?? diagnostic.message;
}

export function errorContextOf(error: unknown): { action?: string; command?: string } {
  if (!(error instanceof AppError)) return {};
  const source = errorContextOf(error.cause);
  return { action: error.action ?? source.action, command: error.command ?? source.command };
}

export function warningNotice(userMessage: string, code: string, message: string): FeedbackNotice {
  return { userMessage, diagnostic: { code, message, location: null } };
}

export function extractFileReferenceFromError(error: unknown): FileReference | null {
  const diagnostic = errorDiagnosticOf(error);
  const location = diagnostic.location;
  const path = diagnostic.fileTarget?.path ?? location?.path;
  if (!path) return null;
  return {
    target: diagnostic.fileTarget,
    path,
    line: location?.line ?? undefined,
    column: location?.column ?? undefined,
    message: formatError(error),
  };
}

export function fileReferenceLocationSuffix(line: number, column?: number): string {
  return column ? `第 ${line} 行，第 ${column} 列` : `第 ${line} 行`;
}

export function appendFileReferenceLocation(message: string, reference: FileReference | null): string {
  if (!reference?.line) return message;
  return `${message} (${fileReferenceLocationSuffix(reference.line, reference.column)})`;
}
