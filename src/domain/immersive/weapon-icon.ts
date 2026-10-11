export type MountShapeKind = 'square' | 'circle' | 'diamond';
export interface MountShape {
  kind: MountShapeKind;
  radius: number;
  color: string;
  alpha: number;
}
const MOUNT_COLORS: Record<string, string> = {
  BALLISTIC: '#ffd700',
  ENERGY: '#46c8ff',
  MISSILE: '#9bff00',
  UNIVERSAL: '#ffffff',
  HYBRID: '#ffa500',
  SYNERGY: '#00ffc8',
  COMPOSITE: '#d7ff00',
  BUILT_IN: '#ffffff',
};
export function weaponMountShapes(type: string, size: string): MountShape[] {
  const radius = { SMALL: 20, MEDIUM: 30, LARGE: 40 }[size] ?? 20;
  const color = MOUNT_COLORS[type] ?? '#ffffff';
  if (type === 'BALLISTIC' || type === 'ENERGY' || type === 'MISSILE') {
    const kind: MountShapeKind = type === 'BALLISTIC' ? 'square' : type === 'ENERGY' ? 'circle' : 'diamond';
    const layers =
      size === 'LARGE'
        ? [
            [40, 0.5],
            [30, 0.25],
            [20, 0.125],
          ]
        : size === 'MEDIUM'
          ? [
              [30, 0.5],
              [20, 0.25],
            ]
          : [[20, 0.5]];
    return layers.map(([radius, alpha]) => ({ kind, radius: radius!, alpha: alpha!, color }));
  }
  const shape = (kind: MountShapeKind, radius: number): MountShape => ({ kind, radius, color, alpha: 0.35 });
  if (type === 'HYBRID')
    return [shape('circle', radius), shape('square', size === 'SMALL' ? 20 * 0.58 : size === 'MEDIUM' ? 40 * 0.65 * 0.71 : 40 * 0.64)];
  if (type === 'SYNERGY') return [shape('circle', radius), shape('diamond', radius * 0.71)];
  if (type === 'COMPOSITE') {
    const r = size === 'MEDIUM' ? 40 * 0.71 : radius;
    return [shape('square', r), shape('diamond', r)];
  }
  if (type === 'UNIVERSAL') return [shape('circle', radius), shape('square', radius * 0.71), shape('diamond', radius * 0.71)];
  if (type === 'BUILT_IN') return [shape('circle', radius)];
  return [];
}
export function drawWeaponMount(context: CanvasRenderingContext2D, type: string, size: string) {
  for (const shape of weaponMountShapes(type, size)) {
    context.fillStyle = shape.color;
    context.globalAlpha = shape.alpha;
    for (let pass = 0; pass < 3; pass++) {
      const radius = shape.radius - pass * 0.25,
        thickness = 3.5 - pass * 0.5;
      context.beginPath();
      if (shape.kind === 'circle') {
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.arc(0, 0, radius - thickness, 0, Math.PI * 2, true);
      } else if (shape.kind === 'square') {
        context.rect(-radius, -radius, radius * 2, radius * 2);
        context.rect(-radius + thickness, -radius + thickness, (radius - thickness) * 2, (radius - thickness) * 2);
      } else {
        for (const inset of [0, thickness * 1.414]) {
          const r = radius - inset;
          context.moveTo(-r, 0);
          context.lineTo(0, r);
          context.lineTo(r, 0);
          context.lineTo(0, -r);
          context.closePath();
        }
      }
      context.fill('evenodd');
    }
  }
  context.globalAlpha = 1;
}
