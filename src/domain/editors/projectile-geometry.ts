import { arr, num, str } from '@/shared/lib/starsector';
import type { RowData } from '@/shared/types';
import type { Point } from './editor-types';

export function projectProjectileGeometry(spec: RowData) {
  const kind = str(spec.specClass, 'projectile');
  const size = arr(spec.size, [10, 20]),
    center = arr(spec.center, [5, 10]);
  const body =
    kind === 'missile'
      ? { x: -center[1]!, y: -center[0]!, width: size[1]!, height: size[0]! }
      : { x: -num(spec.length, 10) / 2, y: -num(spec.width, 3.5) / 2, width: num(spec.length, 10), height: num(spec.width, 3.5) };
  const engines =
    kind === 'missile'
      ? (spec.engineSlots as RowData[]).map((slot) => {
          const loc = arr(slot.loc, [0, 0]);
          return {
            point: { x: loc[0]!, y: -loc[1]! },
            angle: num(slot.angle, 180),
            width: num(slot.width, 8),
            length: num(slot.length, 20),
          };
        })
      : [];
  const radius = kind === 'missile' ? num(spec.collisionRadius, 0) : 0;
  const points: Point[] = [
    { x: body.x, y: body.y },
    { x: body.x + body.width, y: body.y + body.height },
    { x: -radius, y: -radius },
    { x: radius, y: radius },
  ];
  for (const engine of engines) {
    const angle = (-engine.angle * Math.PI) / 180;
    for (const x of [0, engine.length])
      for (const y of [-engine.width / 2, engine.width / 2])
        points.push({
          x: engine.point.x + x * Math.cos(angle) - y * Math.sin(angle),
          y: engine.point.y + x * Math.sin(angle) + y * Math.cos(angle),
        });
  }
  return {
    kind,
    body,
    size,
    center,
    radius,
    engines,
    spriteField: kind === 'missile' ? 'sprite' : 'bulletSprite',
    spritePath: str(spec[kind === 'missile' ? 'sprite' : 'bulletSprite']),
    fringeColor: arr(spec.fringeColor, [255, 255, 255, 255]),
    coreColor: arr(spec.coreColor, [255, 255, 255, 255]),
    extent: { x: Math.max(...points.map((p) => Math.abs(p.x))), y: Math.max(...points.map((p) => Math.abs(p.y))) },
  };
}
export type ProjectileGeometry = ReturnType<typeof projectProjectileGeometry>;
