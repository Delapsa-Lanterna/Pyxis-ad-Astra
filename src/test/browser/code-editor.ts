import type { CodeEditorDelivery, TextFileOpenResult, CodeEditorOpen, NativeWindowRequest, WindowRequestReceipt } from '@/shared/types';

export function createCodeEditorPreview(openWindow: (owner: string, request: NativeWindowRequest) => Promise<WindowRequestReceipt>) {
  type Task = { delivery: CodeEditorDelivery; resolve: (results: TextFileOpenResult[]) => void };
  const queues = new Map<string, Task[]>();
  const channels = new Map<string, { onmessage: (delivery: CodeEditorDelivery) => void }>();
  function publish(label: string) {
    const delivery = queues.get(label)?.[0]?.delivery;
    if (delivery) channels.get(label)?.onmessage(delivery);
  }
  return {
    commands: new Set(['open_code_editor', 'subscribe_code_editor', 'finish_code_editor_open']),
    async invoke(label: string, command: string, args: Record<string, unknown>) {
      if (command === 'open_code_editor') {
        const input = args.input as CodeEditorOpen;
        const opened = await openWindow(label, {
          identity: { type: 'code-editor', sessionId: input.sessionId, modRoot: input.modRoot },
          title: '代码编辑器',
          input: { kind: 'code-editor' },
          width: 1120,
          height: 780,
          minWidth: 800,
          minHeight: 520,
        });
        return new Promise<TextFileOpenResult[]>((resolve) => {
          const queue = queues.get(opened.label) ?? [];
          queue.push({ delivery: { key: String(args.key), files: input.files }, resolve });
          queues.set(opened.label, queue);
          if (queue.length === 1) publish(opened.label);
        });
      }
      if (command === 'subscribe_code_editor') {
        channels.set(label, args.channel as { onmessage: (delivery: CodeEditorDelivery) => void });
        publish(label);
        return;
      }
      const queue = queues.get(label)!;
      const task = queue.shift()!;
      if (task.delivery.key !== args.key) throw new Error('Code editor queue owner mismatch');
      task.resolve(args.results as TextFileOpenResult[]);
      publish(label);
      return undefined;
    },
    release(label: string) {
      for (const task of queues.get(label) ?? [])
        task.resolve(
          task.delivery.files.map((file) => ({
            path: file.path,
            diagnostic: { code: 'code_editor.released', message: 'Preview window released', location: null },
          })),
        );
      queues.delete(label);
      channels.delete(label);
    },
    get pending() {
      return [...queues.values()].reduce((sum, tasks) => sum + tasks.length, 0);
    },
  };
}
