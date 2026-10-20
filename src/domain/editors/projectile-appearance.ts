import type { DeepReadonly, RowData } from '@/shared/types';
import { arr, num, str } from '@/shared/lib/starsector';
import { isRowData } from '@/shared/lib/row-data';

export function projectileAppearance(spec: DeepReadonly<RowData>) {
  const spawn = str(spec.spawnType, 'BALLISTIC');
  const kind: 'missile' | 'beam' | 'ballistic' | 'plasma' | 'none' =
    spec.specClass === 'missile'
      ? 'missile'
      : spec.specClass === 'beam' || spawn === 'BEAM'
        ? 'beam'
        : spawn === 'PLASMA'
          ? 'plasma'
          : spawn === 'BALLISTIC' || spawn === 'BALLISTIC_AS_BEAM'
            ? 'ballistic'
            : 'none';
  return {
    kind,
    spawn,
    length: num(spec.length, 10),
    width: num(spec.width, spec.specClass === 'beam' ? 10 : 3.5),
    size: arr(spec.size, [10, 20]),
    center: arr(spec.center, [5, 10]),
    fringe: arr(spec.fringeColor, [255, 255, 255, 255]),
    core: arr(spec.coreColor, [255, 255, 255, 255]),
    coreWidth: num(spec.coreWidthMult, 1),
    dark: spec.darkCore === true,
    fringePasses: num(spec.darkFringeIter, 1),
    corePasses: num(spec.darkCoreIter, 1),
    scroll: num(spec.textureScrollSpeed, 64),
    fringeScroll: num(spec.fringeScrollSpeedMult, 1),
    texel: num(spec.pixelsPerTexel, 1),
    glowRadius: num(spec.glowRadius),
    glowColor: arr(spec.glowColor, [255, 255, 255, 255]),
    sprite: kind === 'missile' ? 'sprite' : 'bulletSprite',
    spritePath: str(spec[kind === 'missile' ? 'sprite' : 'bulletSprite']),
    engines: (kind === 'missile' && Array.isArray(spec.engineSlots) ? spec.engineSlots.filter(isRowData) : []).map((slot) => {
      const loc = arr(slot.loc, [0, 0]);
      return {
        style: slot.style,
        styleId: slot.styleId,
        styleSpec: slot.styleSpec,
        point: { x: loc[0]!, y: -loc[1]! },
        angle: num(slot.angle, 180),
        width: num(slot.width, 8),
        length: num(slot.length, 20),
      };
    }),
  };
}
export type ProjectileAppearance = ReturnType<typeof projectileAppearance>;
