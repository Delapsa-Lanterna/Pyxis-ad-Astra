import { commandChannel, invokeCommand } from '@/shared/runtime/command.runtime';
import type { JavaManagementAction, JavaManagementSnapshot, JavaDocumentEdit, JavaInspection, JavaQueryPurpose } from '@/shared/types';
import type { JavaAssistance, JavaAssistPurpose } from '@/shared/types';

export function subscribeJavaAnalysis(receive: (snapshot: JavaManagementSnapshot) => void) {
  const subscriptionKey = crypto.randomUUID();
  return invokeCommand<void>('subscribe_java_analysis', { subscriptionKey, channel: commandChannel(receive) }).then(() => subscriptionKey);
}
export function unsubscribeJavaAnalysis(subscriptionKey: string) {
  return invokeCommand<void>('unsubscribe_java_analysis', { subscriptionKey });
}
export function manageJavaAnalysis(action: JavaManagementAction, operationKey: string) {
  return invokeCommand<JavaManagementSnapshot>('manage_java_analysis', { action, operationKey });
}
export function cancelJavaAnalysis(operationKey: string) {
  return invokeCommand<JavaManagementSnapshot>('cancel_java_analysis', { operationKey });
}
export function openJavaAnalysisDirectory(logs: boolean) {
  return invokeCommand<void>('open_java_analysis_directory', { logs });
}
export function javaAnalysisContext(sessionId: string | null, gameRoot: string | null) {
  return invokeCommand<string | null>('java_analysis_context', { sessionId, gameRoot });
}
export function startJavaEditor() {
  return invokeCommand<void>('java_editor', { action: { kind: 'start' } });
}
export function closeJavaEditor() {
  return invokeCommand<void>('java_editor', { action: { kind: 'close' } });
}
export function syncJavaEditor(documents: JavaDocumentEdit[]) {
  return invokeCommand<void>('java_editor', { action: { kind: 'sync', documents } });
}
export function inspectJavaEditor(file: string, offset: number, purpose: JavaQueryPurpose) {
  return invokeCommand<{ result: JavaInspection }>('java_editor', { action: { kind: 'inspect', file, offset, purpose } }).then(
    ({ result }) => result,
  );
}
export function assistJavaEditor(
  file: string,
  offset: number,
  purpose: JavaAssistPurpose,
  name: string | null = null,
  choices: Record<string, string> = {},
  revision = 0,
) {
  return invokeCommand<{ result: JavaAssistance }>('java_editor', {
    action: { kind: 'assist', file, offset, purpose, name, choices, revision },
  }).then(({ result }) => result);
}
