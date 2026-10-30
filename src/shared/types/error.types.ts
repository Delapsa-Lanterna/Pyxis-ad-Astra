export interface ErrorLocation {
  path: string | null;
  line: number | null;
  column: number | null;
}

export interface ErrorDiagnostic {
  code: string;
  message: string;
  location: ErrorLocation | null;
  fileTarget?: FeedbackFileTarget;
}

export interface FeedbackFileTarget {
  mode: 'session' | 'recovery';
  modRoot: string;
  sessionId: string | null;
  path: string;
}

export interface FileReference {
  target?: FeedbackFileTarget;
  path: string;
  line?: number;
  column?: number;
  message: string;
}

export interface FeedbackNotice {
  userMessage: string;
  diagnostic: ErrorDiagnostic;
}

export interface FieldProblem {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}
