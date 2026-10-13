import { onScopeDispose, ref, watch } from 'vue';

export function useEditorImages(source: () => Readonly<Record<string, string>>, changed: () => void) {
  const images = new Map<string, HTMLImageElement>();
  const pending = new Map<string, HTMLImageElement>();
  const tints = new Map<HTMLImageElement, { color: string; canvas: HTMLCanvasElement }>();
  const revision = ref(0);
  let disposed = false;

  function release() {
    for (const image of pending.values()) image.onload = null;
    for (const image of images.values()) image.onload = null;
    pending.clear();
    images.clear();
    tints.clear();
  }

  function reload() {
    release();
    revision.value++;
    for (const [key, data] of Object.entries(source())) {
      if (!data) continue;
      const image = new Image();
      pending.set(key, image);
      image.onload = () => {
        if (disposed || pending.get(key) !== image) return;
        pending.delete(key);
        images.set(key, image);
        revision.value++;
      };
      image.src = data;
    }
  }

  function tintImage(image: HTMLImageElement, rgb: readonly number[]): HTMLCanvasElement {
    const color = rgb.slice(0, 3).join(',');
    const cached = tints.get(image);
    if (cached?.color === color) return cached.canvas;
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let channel = 0; channel < 3; channel++)
        pixels.data[i + channel] = Math.round((pixels.data[i + channel]! * rgb[channel]!) / 255);
    }
    ctx.putImageData(pixels, 0, 0);
    tints.set(image, { color, canvas });
    return canvas;
  }

  watch(source, reload, { immediate: true });
  watch(revision, changed, { flush: 'post' });
  onScopeDispose(() => {
    disposed = true;
    release();
  });
  return { images: images as ReadonlyMap<string, HTMLImageElement>, reload, tintImage };
}
