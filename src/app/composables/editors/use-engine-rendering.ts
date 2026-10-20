import { computed, onScopeDispose, shallowRef, watch } from 'vue';
import { queryEngineRenderAssets, hasEngineAssetsInvalidation } from '@/services/engine-assets.service';
import { subscribeQueryInvalidations } from '@/services/query-cache.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useResourceImages } from '@/app/composables/use-resource-images';
import { windowImageRuntime } from '@/app/composables/use-window-image-runtime';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { engineFallback, loadEngineFallbacks } from '@/app/renderers/editors/engine-fallback';
import {
  createEngineProduct,
  engineBounds,
  enginePaths,
  engineStyle,
  type EngineImages,
  type EngineShape,
  type EngineProduct,
} from '@/app/renderers/editors/engine-renderer';
import { createReadTicket, isReadInvalidated, type ReadTicket } from '@/shared/runtime/read-request';
import { isRowData } from '@/shared/lib/row-data';
import type { DeepReadonly, EngineRenderAssets, ResourceRef, EngineEffect, RowData } from '@/shared/types';

export function useEngineRendering(
  session: () => string,
  changed: () => void,
  source: () => readonly Pick<EngineShape, 'style' | 'styleId' | 'styleSpec'>[],
  url?: (resource: ResourceRef) => string,
) {
  const assets = shallowRef<DeepReadonly<EngineRenderAssets> | null>(null),
    reads = useQueryReadOwner(),
    feedback = useAppFeedback();
  const notify = () => reads.schedule('paint', changed);
  const inlineStyles = computed(() =>
    JSON.stringify([
      ...new Map(
        source()
          .filter((engine) => engine.style === 'CUSTOM' && !engine.styleId && isRowData(engine.styleSpec))
          .map((engine) => [JSON.stringify(engine.styleSpec), engine.styleSpec]),
      ).values(),
    ]),
  );
  const resources = computed(() => {
    const paths = new Set(source().flatMap((engine) => Object.values(enginePaths(engineStyle(engine, assets.value?.styles ?? {})))));
    return [...paths].flatMap((path) => (assets.value?.resources[path] ? [assets.value.resources[path]!] : []));
  });
  const media = useResourceMediaRegistry({ onError: (error) => feedback.error(error, '读取引擎图片失败'), onFailures: () => {} });
  watch(
    () => [session(), resources.value],
    () => {
      if (!url) void media.replaceCollection(session(), 'engines', resources.value);
    },
    { immediate: true },
  );
  const decoded = useResourceImages(
    session,
    () => resources.value.map((resource) => ({ resource, url: url ? url(resource) : (media.dataUrl(session(), resource) ?? '') })),
    notify,
    (error) => feedback.error(error, '解码引擎图片失败'),
  );
  const cache = windowImageRuntime(),
    products = new Map<string, { product: EngineProduct; release: () => void }>(),
    used = new Set<string>();
  let fallbackRead: ReadTicket<Record<string, HTMLImageElement>> | null = null,
    closed = false;
  function prepareFallback() {
    if (fallbackRead) return;
    const request = (fallbackRead = createReadTicket({ lane: 'bundled-engines' }, loadEngineFallbacks));
    void request.promise
      .then(() => {
        request.accept();
        notify();
      })
      .catch((error) => {
        if (!isReadInvalidated(error)) feedback.error(error, '读取引擎回退图片失败');
      });
  }
  async function refresh() {
    reads.revoke();
    if (!source().length) {
      assets.value = null;
      return;
    }
    await reads.consume(
      'engines',
      { sessionId: session(), styles: inlineStyles.value },
      (signal) => queryEngineRenderAssets(session(), JSON.parse(inlineStyles.value) as RowData[], signal),
      {
        ready: (value) => {
          assets.value = value;
          notify();
        },
        error: (error) => feedback.error(error, '读取引擎样式失败'),
      },
    );
  }
  watch(
    () => [session(), source().length > 0, inlineStyles.value],
    (next, previous) => {
      closed = false;
      if (!previous || next[0] !== previous[0] || !next[1]) {
        assets.value = null;
        fallbackRead?.invalidate('consumer');
        fallbackRead = null;
        release();
      }
      void refresh();
    },
    { immediate: true },
  );
  function release() {
    for (const entry of products.values()) entry.release();
    products.clear();
  }
  const stop = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== session() || !hasEngineAssetsInvalidation(event)) return;
    if (event.scope === 'session') {
      closed = true;
      reads.revoke('session');
      assets.value = null;
      fallbackRead?.invalidate('session');
      fallbackRead = null;
      release();
    } else void refresh();
  });
  function paint(draw: (images: EngineImages) => void) {
    used.clear();
    const styles = new Map<
      DeepReadonly<RowData>,
      { images: Record<EngineEffect, HTMLImageElement>; signature: string; dependencies: ResourceRef[] }
    >();
    draw({
      product: (shape) => {
        if (closed || !assets.value || shape.width <= 0 || shape.length <= 0) return null;
        const style = engineStyle(shape, assets.value.styles);
        let prepared = styles.get(style);
        if (!prepared) {
          const images = {} as Record<EngineEffect, HTMLImageElement>,
            dependencies: ResourceRef[] = [],
            versions: unknown[] = [];
          for (const [effect, path] of Object.entries(enginePaths(style)) as [EngineEffect, string][]) {
            const resource = assets.value.resources[path],
              original = resource ? decoded.image(resource) : null,
              image = original ?? engineFallback(effect);
            if (!image) {
              prepareFallback();
              return null;
            }
            images[effect] = image;
            if (resource) dependencies.push(resource);
            versions.push([path, Boolean(original), resource ? cache.revision(session(), resource) : 0]);
          }
          prepared = { images, dependencies, signature: JSON.stringify([session(), style, versions, window.devicePixelRatio]) };
          styles.set(style, prepared);
        }
        const key = JSON.stringify(['engine-static', prepared.signature, shape.preset, shape.kind, shape.width, shape.length, shape.alpha]);
        used.add(key);
        let entry = products.get(key);
        if (!entry) {
          const canvas = cache.thumbnail(key),
            ratio = window.devicePixelRatio;
          const product = canvas
            ? { canvas, ...engineBounds(shape, style, ratio), ratio }
            : createEngineProduct(shape, style, prepared.images, ratio);
          const next = {
            product,
            release: canvas ? cache.retainThumbnail(key) : cache.storeThumbnail(key, session(), prepared.dependencies, product.canvas),
          };
          products.set(key, next);
          entry = next;
        }
        return entry.product;
      },
    });
    for (const [key, entry] of products)
      if (!used.has(key)) {
        entry.release();
        products.delete(key);
      }
  }
  onScopeDispose(() => {
    stop();
    fallbackRead?.invalidate('consumer');
    release();
  });
  return { paint };
}
