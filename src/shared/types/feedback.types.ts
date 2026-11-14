import type { VNodeChild } from 'vue';
import type { FeedbackNotice, FileReference } from './error.types.js';

export const FEEDBACK_LEVELS = ['success', 'info', 'warning', 'error'] as const;
export type FeedbackLevel = (typeof FEEDBACK_LEVELS)[number];
export interface FeedbackContext {
  readonly paths: readonly string[];
}
export interface FeedbackFileAction {
  label: string;
  type: 'default' | 'success' | 'warning' | 'error';
  run: () => void | Promise<void>;
}
export type FeedbackFileActions = (reference: FileReference, level: FeedbackLevel, code: string) => FeedbackFileAction[];

export interface ConfirmOptions {
  cancelText?: string;
  title: string;
  content?: string | (() => VNodeChild);
  actionText: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

export interface ChoiceOption {
  label: string;
  value: string;
  type?: 'primary' | 'warning' | 'error' | 'default';
}

export interface ChooseOptions {
  cancelText?: string | null;
  title: string;
  type?: FeedbackLevel;
  content?: string | (() => VNodeChild);
  choices: ChoiceOption[];
}

export interface WindowFeedback extends AppFeedback {
  fileActions: FeedbackFileActions;
}

export interface AppFeedback {
  success(message: string, context?: FeedbackContext): void;
  info(message: string, context?: FeedbackContext): void;
  warning(notice: FeedbackNotice, context?: FeedbackContext): void;
  error(error: unknown, contextMessage?: string, context?: FeedbackContext): void;
  confirmDanger(options: ConfirmOptions): void;
  confirmWarning(options: ConfirmOptions): void;
  choose(options: ChooseOptions): Promise<string | null>;
}
