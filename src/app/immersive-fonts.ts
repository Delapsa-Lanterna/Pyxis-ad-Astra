import body from '@/assets/immersive/fonts/insignia15LTaa.fnt?raw';
import heading from '@/assets/immersive/fonts/orbitron12condensed.fnt?raw';
import title from '@/assets/immersive/fonts/orbitron20aabold.fnt?raw';
import bodyAtlas from '@/assets/immersive/fonts/insignia15LTaa_0.png';
import headingAtlas from '@/assets/immersive/fonts/orbitron12condensed_0.png';
import titleAtlas from '@/assets/immersive/fonts/orbitron20aabold_0.png';
import { parseBitmapFont, type ImmersiveFontRole } from '@/domain/immersive/bitmap-font';
export const IMMERSIVE_FONTS = { body: parseBitmapFont(body), heading: parseBitmapFont(heading), 'ship-title': parseBitmapFont(title) };
const atlasUrls = { body: bodyAtlas, heading: headingAtlas, 'ship-title': titleAtlas };
const decoded = new Map<ImmersiveFontRole, Promise<HTMLImageElement>>();
export function loadImmersiveAtlas(role: ImmersiveFontRole): Promise<HTMLImageElement> {
  let promise = decoded.get(role);
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`内置沉浸式字库解码失败：${role}`));
      image.src = atlasUrls[role];
    });
    decoded.set(role, promise);
  }
  return promise;
}
