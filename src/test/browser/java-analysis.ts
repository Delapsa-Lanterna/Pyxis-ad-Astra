import type { JavaManagementAction, JavaManagementSnapshot } from '@/shared/types';

export function createJavaComponentPreview() {
  const listeners = new Map<string, { onmessage: (value: JavaManagementSnapshot) => void }>();
  const completions = new Map<string, Array<(value: JavaManagementSnapshot) => void>>();
  function waitForCompletion(operationKey: string) {
    return new Promise<JavaManagementSnapshot>((resolve) => {
      const waiting = completions.get(operationKey) ?? [];
      waiting.push(resolve);
      completions.set(operationKey, waiting);
    });
  }
  let state: JavaManagementSnapshot = {
    revision: 1,
    operationKey: null,
    queued: 0,
    action: null,
    active: false,
    phase: 'idle',
    installation: 'missing',
    jdtVersion: '3.47.0',
    downloadBytes: 16423216,
    installationPath: 'C:/示例配置/组件缓存/java-analysis/dependencies/jdt-3.47.0-fixed',
    logPath: 'C:/示例配置/java-analysis/logs',
    stagedBytes: 0,
    instances: 0,
    projects: 0,
    progress: null,
    environment: null,
    error: null,
  };
  function publish(patch: Partial<JavaManagementSnapshot>) {
    state = { ...state, ...patch, revision: state.revision + 1 };
    for (const listener of listeners.values()) listener.onmessage(structuredClone(state));
    if (!state.active && state.operationKey) {
      for (const complete of completions.get(state.operationKey) ?? []) complete(structuredClone(state));
      completions.delete(state.operationKey);
    }
    return structuredClone(state);
  }
  return {
    get snapshot() {
      return structuredClone(state);
    },
    publish,
    commands: new Set([
      'subscribe_java_analysis',
      'unsubscribe_java_analysis',
      'manage_java_analysis',
      'cancel_java_analysis',
      'java_analysis_context',
      'open_java_analysis_directory',
    ]),
    invoke(command: string, args: Record<string, unknown>) {
      switch (command) {
        case 'subscribe_java_analysis': {
          const id = String(args.subscriptionKey);
          const channel = args.channel as { onmessage: (value: JavaManagementSnapshot) => void };
          listeners.set(id, channel);
          channel.onmessage(structuredClone(state));
          return id;
        }
        case 'unsubscribe_java_analysis':
          listeners.delete(String(args.subscriptionKey));
          return;
        case 'java_analysis_context':
          return 'G:/示例游戏/jre/bin/java.exe';
        case 'open_java_analysis_directory':
          return;
        case 'cancel_java_analysis':
          return String(args.operationKey) === state.operationKey
            ? publish({ active: false, phase: 'cancelled', stagedBytes: 1024 * 1024 })
            : structuredClone(state);
        case 'manage_java_analysis': {
          const action = args.action as JavaManagementAction;
          const operationKey = String(args.operationKey);
          if (state.active) {
            const sameAction = JSON.stringify(state.action) === JSON.stringify(action);
            if (sameAction) return waitForCompletion(state.operationKey!);
            publish({ queued: state.queued + 1 });
            return waitForCompletion(operationKey);
          }
          if (action.kind === 'download') {
            const completed = waitForCompletion(operationKey);
            publish({
              operationKey,
              action,
              active: true,
              phase: 'downloading',
              error: null,
              progress: { phase: 'downloading', completedBytes: 4096000, totalBytes: 16423216, filesDone: 5, filesTotal: 27 },
            });
            return completed;
          }
          if (action.kind === 'remove')
            return publish({ operationKey, action, installation: 'missing', stagedBytes: 0, phase: 'succeeded' });
          if (action.kind === 'stop') return publish({ operationKey, action, instances: 0, projects: 0, phase: 'succeeded' });
          if (action.kind === 'probe' || action.kind === 'test')
            return publish({
              operationKey,
              action,
              phase: 'succeeded',
              environment: { path: action.javaPath, version: '17', milliseconds: 350, released: true, logPath: null },
            });
          return publish({ operationKey, action, phase: 'succeeded' });
        }
        default:
          throw new Error('Unknown Java preview command: ' + command);
      }
    },
  };
}
