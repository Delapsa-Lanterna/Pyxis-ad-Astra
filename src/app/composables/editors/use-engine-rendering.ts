import { onScopeDispose, shallowRef, watch } from 'vue';
import { queryEngineRenderAssets, hasEngineAssetsInvalidation } from '@/services/engine-assets.service';
import { subscribeQueryInvalidations } from '@/services/query-cache.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useResourceImages } from '@/app/composables/use-resource-images';
import { windowImageRuntime } from '@/app/composables/use-window-image-runtime';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { engineFallback, loadEngineFallbacks } from '@/app/renderers/editors/engine-fallback';
import type { EngineImages } from '@/app/renderers/editors/engine-renderer';
import { createReadTicket, isReadInvalidated, type ReadTicket } from '@/shared/runtime/read-request';
import type { DeepReadonly, EngineRenderAssets, ResourceRef } from '@/shared/types';

export function useEngineRendering(
  session: () => string,
  changed: () => void,
  enabled: () => boolean,
  url?: (resource: ResourceRef) => string,
) {
  const assets = shallowRef<DeepReadonly<EngineRenderAssets> | null>(null),
    reads = useQueryReadOwner(),
    feedback = useAppFeedback();
  const notify = () => reads.schedule('paint', changed);
  const media = useResourceMediaRegistry({ onError: (error) => feedback.error(error, '读取引擎图片失败'), onFailures: () => {} });
  const resources = () => (enabled() && assets.value ? Object.values(assets.value.resources) : []);
  watch(
    () => [session(), resources()],
    () => {
      if (!url) void media.replaceCollection(session(), 'engines', resources());
    },
    { immediate: true },
  );
  const decoded = useResourceImages(
    session,
    () => resources().map((resource) => ({ resource, url: url ? url(resource) : (media.dataUrl(session(), resource) ?? '') })),
    notify,
    (error) => feedback.error(error, '解码引擎图片失败'),
  );
  const cache = windowImageRuntime(),
    tints = new Map<string, { canvas: HTMLCanvasElement; release: () => void }>(),
    used = new Set<string>();
  let fallbackRead: ReadTicket<Record<string, HTMLImageElement>> | null = null;
  let closed = false;
  function prepareFallback() {
    if (fallbackRead) return;
    fallbackRead = createReadTicket({ lane: 'bundled-engines' }, loadEngineFallbacks);
    void fallbackRead.promise
      .then(() => {
        if (!decoded.ready()) notify();
      })
      .catch((error) => {
        if (!isReadInvalidated(error)) feedback.error(error, '读取引擎回退图片失败');
      });
  }
  async function refresh() {
    reads.revoke();
    if (!enabled()) {
      assets.value = null;
      return;
    }
    await reads.consume('engines', { sessionId: session() }, (signal) => queryEngineRenderAssets(session(), signal), {
      ready: (value) => {
        assets.value = value;
        notify();
      },
      error: (error) => feedback.error(error, '读取引擎样式失败'),
    });
  }
  watch(
    () => [session(), enabled()],
    () => {
      closed = false;
      assets.value = null;
      void refresh();
    },
    { immediate: true },
  );
  const stop = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== session() || !hasEngineAssetsInvalidation(event)) return;
    if (event.scope === 'session') {
      closed = true;
      reads.revoke('session');
      assets.value = null;
      fallbackRead?.invalidate('session');
      for (const entry of tints.values()) entry.release();
      tints.clear();
    } else void refresh();
  });
  function image(effect: Parameters<EngineImages['image']>[0], color: readonly unknown[]) {
    if (closed) return null;
    const resource = assets.value?.resources[effect],
      original = resource ? decoded.image(resource) : null;
    const bitmap = original ?? engineFallback(effect);
    if (!bitmap) {
      prepareFallback();
      return null;
    }
    if (!original && color[0] === 255 && color[1] === 255 && color[2] === 255) return bitmap;
    const width = original ? bitmap.width : 32 * window.devicePixelRatio,
      height = original ? bitmap.height : width;
    const key = JSON.stringify([
      'engine',
      session(),
      effect,
      Boolean(original),
      resource ? cache.key(session(), resource) : null,
      resource ? cache.revision(session(), resource) : 0,
      width,
      height,
      color.slice(0, 3),
    ]);
    used.add(key);
    let entry = tints.get(key);
    if (!entry) {
      let canvas = cache.thumbnail(key),
        release: () => void;
      if (canvas) release = cache.retainThumbnail(key);
      else {
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0, width, height);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = 'rgb(' + color.slice(0, 3).join(',') + ')';
        ctx.fillRect(0, 0, width, height);
        release = cache.storeThumbnail(key, session(), original && resource ? [resource] : [], canvas);
      }
      entry = { canvas, release };
      tints.set(key, entry);
    }
    return entry.canvas;
  }
  function paint(draw: (images: EngineImages) => void) {
    used.clear();
    const images = new Map<readonly unknown[], Map<Parameters<EngineImages['image']>[0], ReturnType<EngineImages['image']>>>();
    draw({
      styles: assets.value?.styles ?? {},
      image: (effect, color) => {
        let effects = images.get(color);
        if (!effects) {
          effects = new Map();
          images.set(color, effects);
        }
        if (!effects.has(effect)) effects.set(effect, image(effect, color));
        return effects.get(effect)!;
      },
    });
    for (const [key, entry] of tints)
      if (!used.has(key)) {
        entry.release();
        tints.delete(key);
      }
  }
  onScopeDispose(() => {
    stop();
    fallbackRead?.invalidate('consumer');
    for (const entry of tints.values()) entry.release();
    tints.clear();
  });
  return { paint };
}
