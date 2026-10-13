import { effectScope, nextTick, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditorImages } from './use-editor-images';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('editor image lifecycle', () => {
  it('replaces resources, redraws empty input and rejects callbacks from released images', async () => {
    const created: Array<{ onload: (() => void) | null; src: string }> = [];
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        src = '';
        constructor() {
          created.push(this);
        }
      },
    );
    const source = ref({ sprite: 'first' });
    const changed = vi.fn();
    const scope = effectScope();
    const runtime = scope.run(() => useEditorImages(() => source.value, changed))!;
    const first = created[0]!;
    const lateFirst = first.onload!;
    first.onload!();
    await nextTick();
    expect(runtime.images.get('sprite')).toBe(first);
    source.value = { sprite: 'second' };
    await nextTick();
    expect(runtime.images.size).toBe(0);
    expect(first.onload).toBeNull();
    const second = created[1]!;
    second.onload!();
    await nextTick();
    lateFirst();
    expect(runtime.images.get('sprite')).toBe(second);
    const beforeClear = changed.mock.calls.length;
    source.value = { sprite: '' };
    await nextTick();
    expect(runtime.images.size).toBe(0);
    expect(changed).toHaveBeenCalledTimes(beforeClear + 1);
    source.value = { sprite: 'pending' };
    await nextTick();
    const pending = created[2]!;
    const latePending = pending.onload!;
    scope.stop();
    expect(pending.onload).toBeNull();
    latePending();
    expect(runtime.images.size).toBe(0);
  });
});

describe('canvas image tint cache', () => {
  it('multiplies RGB while preserving alpha and replaces cached colors and resources', () => {
    const drawImage = vi.fn();
    const putImageData = vi.fn();
    const context = {
      drawImage,
      getImageData: () => ({ data: new Uint8ClampedArray([200, 100, 50, 128, 20, 40, 60, 0]) }),
      putImageData,
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    const scope = effectScope();
    const drawing = scope.run(() =>
      useEditorImages(
        () => ({}),
        () => {},
      ),
    )!;
    const image = { width: 2, height: 1 } as HTMLImageElement;
    const gray = drawing.tintImage(image, [127, 127, 127]);
    expect(Array.from(putImageData.mock.calls[0]![0].data)).toEqual([100, 50, 25, 128, 10, 20, 30, 0]);
    expect(drawing.tintImage(image, [127, 127, 127])).toBe(gray);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawing.tintImage(image, [255, 0, 0])).not.toBe(gray);
    expect(Array.from(putImageData.mock.calls[1]![0].data)).toEqual([200, 0, 0, 128, 20, 0, 0, 0]);
    drawing.reload();
    expect(drawing.tintImage(image, [127, 127, 127])).not.toBe(gray);
    const replacement = { width: 2, height: 1 } as HTMLImageElement;
    const before = drawing.tintImage(replacement, [127, 127, 127]);
    expect(before).not.toBe(gray);
    scope.stop();
  });
});
