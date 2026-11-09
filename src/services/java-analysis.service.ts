import { commandChannel, invokeCommand } from '@/shared/runtime/command.runtime';
import type { JavaManagementAction, JavaManagementSnapshot } from '@/shared/types';

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
