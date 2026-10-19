import glow from '@/assets/engines/glow.svg';
import flame from '@/assets/engines/flame.svg';
import hitGlow from '@/assets/engines/hit-glow.svg';

let images: Promise<Record<string, HTMLImageElement>> | null = null;
const ready: Record<string, HTMLImageElement> = {};
export function engineFallback(effect: string) {
  return ready[effect] ?? null;
}
export function loadEngineFallbacks() {
  return (images ??= Promise.all(
    Object.entries({ engineGlow: glow, engineFlame: flame, engineHitGlow: hitGlow }).map(
      ([key, url]) =>
        new Promise<readonly [string, HTMLImageElement]>((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            image.onload = image.onerror = null;
            ready[key] = image;
            resolve([key, image]);
          };
          image.onerror = () => {
            image.onload = image.onerror = null;
            reject(new Error('本地引擎图片读取失败：' + key));
          };
          image.src = url;
        }),
    ),
  ).then(Object.fromEntries));
}
