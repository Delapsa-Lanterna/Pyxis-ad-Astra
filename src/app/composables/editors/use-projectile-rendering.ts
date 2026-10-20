import { computed, onScopeDispose, ref, watch } from 'vue';
import type { ResourceRef } from '@/shared/types';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { useResourceImages } from '@/app/composables/use-resource-images';
import { windowImageRuntime } from '@/app/composables/use-window-image-runtime';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import type { ProjectileImages, ProjectileTexture, TextureShape } from '@/app/renderers/editors/projectile-renderer';

export function useProjectileRendering(
  session: () => string,
  source: () => readonly ResourceRef[],
  changed: () => void,
  supplied?: (resource: ResourceRef) => string,
  failed?: () => void,
) {
  const feedback = useAppFeedback(),
    reads = useQueryReadOwner(),
    cache = windowImageRuntime();
  const revision = ref(0),
    settled = ref(Boolean(supplied));
  const notify = () => {
    revision.value++;
    reads.schedule('paint', changed);
  };
  const media = useResourceMediaRegistry({
    onError: (error) => feedback.error(error, '读取发射图片失败'),
    onFailures: (resources) => feedback.error(new Error(resources.map((resource) => resource.relPath).join('\n')), '找不到发射图片'),
  });
  watch(
    () => [session(), source()],
    () => {
      if (supplied) return;
      settled.value = false;
      void reads.consume(
        'media',
        { session: session(), resources: source() },
        () => media.replaceCollection(session(), 'projectiles', source(), true),
        {
          ready: () => {
            settled.value = true;
            notify();
          },
          error: (error) => feedback.error(error, '读取发射图片失败'),
        },
      );
    },
    { immediate: true },
  );
  const url = (resource: ResourceRef) => (supplied ? supplied(resource) : (media.dataUrl(session(), resource) ?? ''));
  const decoded = useResourceImages(
    session,
    () => source().map((resource) => ({ resource, url: url(resource) })),
    notify,
    (error) => {
      failed?.();
      feedback.error(error, '解码发射图片失败');
    },
  );
  const products = new Map<string, { canvas: HTMLCanvasElement; release(): void }>(),
    used = new Set<string>(),
    patterns = new WeakMap<ProjectileTexture, CanvasPattern>();
  function texture(
    resource: ResourceRef,
    color?: readonly number[],
    shape: TextureShape = 'plain',
    outer?: readonly number[],
  ): ProjectileTexture | null {
    const image = decoded.image(resource);
    if (!image || !color) return image;
    const key = JSON.stringify([
      'projectile',
      cache.key(session(), resource),
      cache.revision(session(), resource),
      color.slice(0, 3),
      shape,
      outer?.slice(0, 3),
    ]);
    used.add(key);
    let product = products.get(key);
    if (!product) {
      let canvas = cache.thumbnail(key),
        release: () => void;
      if (canvas) release = cache.retainThumbnail(key);
      else {
        canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        if (shape === 'start') {
          ctx.beginPath();
          ctx.moveTo(0, canvas.height / 2);
          ctx.lineTo(canvas.width, 0);
          ctx.lineTo(canvas.width, canvas.height);
          ctx.closePath();
          ctx.clip();
        }
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const x = ((i / 4) % canvas.width) / canvas.width,
            y = Math.floor(i / 4 / canvas.width) / canvas.height;
          for (let channel = 0; channel < 3; channel++)
            pixels.data[i + channel] =
              (pixels.data[i + channel]! *
                (shape.startsWith('plasma') && outer ? color[channel]! * (1 - y) + outer[channel]! * y : color[channel]!)) /
              255;
          if (shape === 'end') pixels.data[i + 3] = pixels.data[i + 3]! * (1 - x);
        }
        ctx.putImageData(pixels, 0, 0);
        if (shape.startsWith('plasma')) {
          const ray = canvas,
            size = image.height,
            count = shape === 'plasma6' ? 6 : 5;
          canvas = document.createElement('canvas');
          canvas.width = canvas.height = size * 2;
          const composite = canvas.getContext('2d')!;
          composite.translate(size, size);
          composite.globalCompositeOperation = 'lighter';
          for (let i = 0; i < count; i++) {
            composite.save();
            composite.rotate((i * Math.PI * 2) / count);
            composite.drawImage(ray, -size / 8, -size * 0.2, size / 4, size);
            composite.restore();
          }
        }
        release = cache.storeThumbnail(key, session(), [resource], canvas);
      }
      product = { canvas, release };
      products.set(key, product);
    }
    return product.canvas;
  }
  function paint(draw: (images: (resources: Readonly<Record<string, ResourceRef>>) => ProjectileImages) => void) {
    used.clear();
    const providers = new Map<Readonly<Record<string, ResourceRef>>, ProjectileImages>();
    draw((resources) => {
      let provider = providers.get(resources);
      if (!provider) {
        const resolved = new Map<string, Map<string, ProjectileTexture | null>>();
        const image: ProjectileImages['image'] = (key, color, shape, outer) => {
          const tint = color?.join(',') ?? '';
          let colored = resolved.get(tint);
          if (!colored) resolved.set(tint, (colored = new Map()));
          const signature = key + ':' + shape + ':' + outer?.join(',');
          if (!colored.has(signature)) colored.set(signature, resources[key] ? texture(resources[key], color, shape, outer) : null);
          return colored.get(signature)!;
        };
        provider = {
          image,
          pattern: (ctx, key, color) => {
            const source = image(key, color)!;
            let pattern = patterns.get(source);
            if (!pattern) {
              pattern = ctx.createPattern(source, 'repeat')!;
              patterns.set(source, pattern);
            }
            return pattern;
          },
        };
        providers.set(resources, provider);
      }
      return provider;
    });
    for (const [key, product] of products)
      if (!used.has(key)) {
        product.release();
        products.delete(key);
      }
  }
  onScopeDispose(() => {
    for (const product of products.values()) product.release();
    products.clear();
  });
  return {
    paint,
    image: decoded.image,
    ready: computed(() => {
      void revision.value;
      return settled.value && source().every((resource) => !url(resource) || Boolean(decoded.image(resource)));
    }),
  };
}
