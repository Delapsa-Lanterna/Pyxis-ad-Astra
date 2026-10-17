import { requestNativeWindow } from '@/services/window.service';
import type { NativeWindowRequest, WindowRequestReceipt } from '@/shared/types';
export interface ManagedWindowSize {
  height: number;
  minHeight: number;
  minWidth: number;
  width: number;
}
export type ManagedWindowRequest = Omit<NativeWindowRequest, keyof ManagedWindowSize> & { size: ManagedWindowSize };
export async function requestWindow(request: ManagedWindowRequest): Promise<WindowRequestReceipt> {
  const { size, ...input } = request;
  return requestNativeWindow({ ...input, ...size });
}
