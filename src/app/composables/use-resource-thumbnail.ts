import { onScopeDispose, watch, type Ref } from 'vue';
import type { ResourceRef } from '@/shared/types';
import { windowImageRuntime, type ThumbnailRequest } from './use-window-image-runtime';
import { createReadTicket, isReadInvalidated, type ReadTicket } from '@/shared/runtime/read-request';

export function resourceThumbnailRequest(
  sessionId: string,
  resource: ResourceRef,
  width: number,
  height: number,
  url?: string,
): ThumbnailRequest {
  const runtime = windowImageRuntime(),
    ratio = window.devicePixelRatio;
  return {
    key: JSON.stringify(['thumbnail', runtime.key(sessionId, resource), runtime.revision(sessionId, resource), width, height, ratio]),
    sessionId,
    capture: () => resourceThumbnailRequest(sessionId, resource, width, height, url),
    resources: [resource],
    url: url ? () => url : undefined,
    render: (image) => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const context = canvas.getContext('2d')!,
        bitmap = image(resource);
      context.imageSmoothingEnabled = false;
      if (bitmap) {
        const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height),
          w = Math.round(bitmap.width * scale),
          h = Math.round(bitmap.height * scale);
        context.drawImage(bitmap, Math.round((canvas.width - w) / 2), Math.round((canvas.height - h) / 2), w, h);
      }
      return canvas;
    },
  };
}
export function useResourceThumbnail(
  surface: Ref<HTMLCanvasElement | null>,
  source: () => ThumbnailRequest,
  active: () => boolean,
  failed: (error: unknown) => void,
) {
  const runtime = windowImageRuntime();
  let lease: ReturnType<typeof runtime.acquireThumbnail> | null = null,
    signature = '',
    generation = 0,
    painted = false;
  let waiting: ReadTicket<HTMLCanvasElement> | null = null;
  function paint() {
    const canvas = surface.value;
    if (!canvas) return;
    if (!active()) {
      generation++;
      waiting?.invalidate('consumer');
      lease?.release();
      lease = null;
      if (!painted) signature = '';
      return;
    }
    const request = source();
    if (signature === request.key && (lease || painted)) return;
    const viewport = canvas.closest('[data-media-viewport]');
    const priority = viewport ? undefined : 'visible';
    const current = ++generation,
      next = runtime.acquireThumbnail(request, priority),
      previous = lease;
    waiting?.invalidate('consumer');
    lease = next;
    signature = request.key;
    painted = false;
    previous?.release();
    const accept = (finished: HTMLCanvasElement) => {
      if (current !== generation) return;
      painted = true;
      canvas.width = finished.width;
      canvas.height = finished.height;
      canvas.getContext('2d')!.drawImage(finished, 0, 0);
    };
    if (next.canvas) accept(next.canvas);
    else {
      waiting = createReadTicket({ sessionId: request.sessionId, thumbnail: request.key }, () => next.promise);
      void waiting.promise
        .then((finished) => {
          waiting?.accept();
          accept(finished);
        })
        .catch((error) => {
          if (current !== generation) return;
          next.release();
          lease = null;
          signature = '';
          if (!isReadInvalidated(error)) failed(error);
        });
    }
  }
  watch(() => [surface.value, active(), source().key], paint, { flush: 'post' });
  window.addEventListener('resize', paint);
  onScopeDispose(() => {
    generation++;
    waiting?.invalidate('consumer');
    lease?.release();
    window.removeEventListener('resize', paint);
  });
}
