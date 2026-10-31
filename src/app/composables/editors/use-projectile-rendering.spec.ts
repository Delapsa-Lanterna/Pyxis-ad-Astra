import { effectScope } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { useProjectileRendering } from './use-projectile-rendering';
import { windowImageRuntime } from '../use-window-image-runtime';
import { invalidateResourceMediaByProject } from '@/services/resource-media.service';
import { createCanvasRecorder } from '@/test/unit/canvas-recorder';
import type { ResourceRef, ProjectInvalidation } from '@/shared/types';
import type { TextureShape } from '@/app/renderers/editors/projectile-renderer';

vi.mock('../use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));
vi.mock('../use-resource-media-registry', () => ({ useResourceMediaRegistry: () => ({ replaceCollection: vi.fn(), dataUrl: vi.fn() }) }));
afterEach(() => {
  windowImageRuntime().clearSession('projectile-work');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(['plain', 'start', 'end', 'plasma5', 'plasma6'] as const)(
  'constructs and shares %s products once per resource revision',
  async (shape: TextureShape) => {
    const images: object[] = [];
    vi.stubGlobal(
      'Image',
      class {
        width = 4;
        height = 4;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        constructor() {
          images.push(this);
        }
        set src(_url: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const context = createCanvasRecorder().ctx;
    const pixels = vi.fn(() => ({ data: new Uint8ClampedArray(64) }));
    const patterns = vi.fn(() => ({}) as CanvasPattern);
    Object.assign(context, { getImageData: pixels, createPattern: patterns });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const creates = vi.spyOn(document, 'createElement');
    const resource: ResourceRef = { source: 'mod', ownerKind: 'weapon', ownerId: 'sample', key: 'sprite', relPath: `${shape}.png` };
    const refs = { sprite: resource },
      color = [100, 150, 200, 255];
    const scope = effectScope();
    const create = () =>
      useProjectileRendering(
        () => 'projectile-work',
        () => [resource],
        vi.fn(),
        () => 'data:sample',
      );
    const first = scope.run(create)!,
      second = scope.run(create)!;
    try {
      await flushPromises();
      const paint = (runtime: typeof first) =>
        runtime.paint((provide) => {
          const provider = provide(refs);
          const product = provider.image('sprite', color, shape);
          expect(provider.image('sprite', color, shape)).toBe(product);
          if (shape === 'plain') {
            expect(provider.pattern(context, 'sprite', color)).toBe(provider.pattern(context, 'sprite', color));
          }
        });
      const canvases = () => creates.mock.calls.filter(([tag]) => tag === 'canvas').length;
      paint(first);
      paint(first);
      paint(second);
      const perRevision = shape.startsWith('plasma') ? 2 : 1;
      expect(images).toHaveLength(1);
      expect(pixels).toHaveBeenCalledTimes(1);
      expect(canvases()).toBe(perRevision);
      if (shape === 'plain') expect(patterns).toHaveBeenCalledTimes(2);
      const invalidation: ProjectInvalidation = {
        paths: [],
        tables: [],
        entities: [],
        resources: [{ source: 'mod', relPath: resource.relPath }],
        queryScopes: [],
        session: false,
      };
      invalidateResourceMediaByProject('projectile-work', invalidation);
      await flushPromises();
      paint(first);
      paint(second);
      paint(first);
      expect(images).toHaveLength(2);
      expect(pixels).toHaveBeenCalledTimes(2);
      expect(canvases()).toBe(perRevision * 2);
      if (shape === 'plain') expect(patterns).toHaveBeenCalledTimes(4);
    } finally {
      scope.stop();
    }
  },
);
