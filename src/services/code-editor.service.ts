import { commandChannel, invokeCommand } from '@/shared/runtime/command.runtime';
import type { CodeEditorDelivery, CodeEditorFileResult, CodeEditorOpen } from '@/shared/types';

export function openCodeEditor(input: CodeEditorOpen) {
  return invokeCommand<CodeEditorFileResult[]>('open_code_editor', { key: crypto.randomUUID(), input });
}
export function subscribeCodeEditor(receive: (delivery: CodeEditorDelivery) => void) {
  return invokeCommand<void>('subscribe_code_editor', { channel: commandChannel(receive) });
}
export function finishCodeEditorOpen(key: string, results: CodeEditorFileResult[]) {
  return invokeCommand<void>('finish_code_editor_open', { key, results });
}
