import type { Point } from '@/domain/editors/editor-types';
export function variantSlotPoint(location: readonly number[]): Point {
  return { x: -location[1]!, y: -location[0]! };
}
export function variantArcPath(angle: number, arc: number): string {
  const sweep = Math.max(30, arc),
    direction = ((-angle - 90) * Math.PI) / 180;
  if (sweep >= 360) return 'M -7.5 0 A 7.5 7.5 0 1 0 7.5 0 A 7.5 7.5 0 1 0 -7.5 0';
  const start = direction - (sweep * Math.PI) / 360,
    end = direction + (sweep * Math.PI) / 360;
  return (
    'M 0 0 L ' +
    Math.cos(start) * 7.5 +
    ' ' +
    Math.sin(start) * 7.5 +
    ' A 7.5 7.5 0 ' +
    (sweep > 180 ? 1 : 0) +
    ' 1 ' +
    Math.cos(end) * 7.5 +
    ' ' +
    Math.sin(end) * 7.5 +
    ' Z'
  );
}
const formations = {
  default: [
    [],
    [0, 0],
    [-0.35, 0, 0.35, 0],
    [0, 0.33, -0.33, -0.2, 0.33, -0.2],
    [0, 0.4, -0.4, 0, 0.4, 0, 0, -0.4],
    [0, 0.45, -0.45, 0.3, 0.45, 0.3, -0.35, -0.33, 0.35, -0.33],
    [0, 0.4, -0.4, 0.25, 0.4, 0.25, 0, -0.4, -0.4, -0.25, 0.4, -0.25],
  ],
  BOX: [
    [],
    [0, 0],
    [-0.35, 0, 0.35, 0],
    [0, 0, -0.45, 0, 0.45, 0],
    [-0.4, 0.4, -0.4, -0.4, 0.4, 0.4, 0.4, -0.4],
    [0, -0.3, -0.45, -0.3, 0.45, -0.3, -0.25, 0.33, 0.25, 0.33],
    [0, 0.25, -0.5, 0.25, 0.5, 0.25, 0, -0.25, -0.5, -0.25, 0.5, -0.25],
  ],
  CLAW: [
    [],
    [0, 0],
    [-0.35, 0.1, 0.35, 0],
    [0, -0.33, -0.33, 0.2, 0.33, 0.2],
    [-0.45, 0.5, -0.35, 0, 0.45, 0, 0.05, -0.4],
    [0, 0.05, -0.45, 0.3, 0.45, 0.3, -0.35, -0.33, 0.35, -0.33],
    [0, 0.15, -0.4, 0.25, 0.4, 0.25, 0, -0.4, -0.4, -0.25, 0.4, -0.25],
  ],
  V: [
    [],
    [0, 0],
    [-0.35, 0, 0.35, 0.1],
    [0, 0.33, -0.33, -0.2, 0.33, -0.2],
    [0.15, 0.45, -0.2, 0.05, 0.5, 0.05, -0.5, -0.4],
    [0, 0.45, -0.45, 0.3, 0.45, 0.3, -0.35, -0.33, 0.35, -0.33],
    [0, 0.4, -0.4, 0.25, 0.4, 0.25, 0, -0.15, -0.4, -0.25, 0.4, -0.25],
  ],
};
export function variantWingFormation(count: number, formation: string): Point[] {
  const offsets = (formations[formation as keyof typeof formations] ?? formations.default)[Math.min(6, count)]!;
  return Array.from({ length: offsets.length / 2 }, (_, index) => ({ x: offsets[index * 2]!, y: -offsets[index * 2 + 1]! }));
}
export interface VariantWingLayout {
  points: Point[];
  spriteHeight: number;
  diagnostic: string;
}
export function variantWingLayout(count: number, formation: string, rendererSize: number): VariantWingLayout {
  if (!Number.isInteger(count) || count < 0) return { points: [], spriteHeight: 0, diagnostic: '联队数量缺失或无效' };
  if (!['V', 'BOX', 'CLAW', 'DIAMOND'].includes(formation))
    return { points: [], spriteHeight: 0, diagnostic: '联队阵型缺失或无效：' + formation };
  const distance = rendererSize / 2;
  return {
    points: variantWingFormation(count, formation).map((point) => ({ x: point.x * distance, y: point.y * distance })),
    spriteHeight: 0.75 * distance * (1 - count / 15),
    diagnostic: '',
  };
}
