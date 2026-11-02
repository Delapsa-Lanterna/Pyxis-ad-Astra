import { requestNativeWindow } from '@/services/window.service';
import type { NativeWindowRequest, WindowRequestReceipt } from '@/shared/types';
import { recordQueuedLog } from '@/shared/runtime/app-log-queue';
import { logFields } from '@/shared/lib/log-fields';
export interface ManagedWindowSize {
  height: number;
  minHeight: number;
  minWidth: number;
  width: number;
}
export type ManagedWindowRequest = Omit<NativeWindowRequest, keyof ManagedWindowSize> & { size: ManagedWindowSize };
export async function requestWindow(request: ManagedWindowRequest): Promise<WindowRequestReceipt> {
  const { size, ...input } = request;
  const receipt = await requestNativeWindow({ ...input, ...size });
  recordQueuedLog({
    level: 'info',
    code: input.input.kind === 'file-editor' ? 'editor.file_opened' : 'editor.window_opened',
    message: 'window request ' + receipt.status,
    path: 'path' in input.identity ? input.identity.path : null,
    line: null,
    fields: logFields({
      ...input.identity,
      kind: input.input.kind,
      label: receipt.label,
      requestId: receipt.requestId,
      status: receipt.status,
    }),
  });
  return receipt;
}
