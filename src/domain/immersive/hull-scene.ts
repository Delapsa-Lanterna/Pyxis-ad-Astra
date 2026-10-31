import type { Point } from '@/domain/editors/editor-types';
import type {
  JointEditSnapshot,
  JointValue,
  JointHullProjection,
  RowData,
  ReadonlyVariantEntry,
  JointPreviewSpec,
  DeepReadonly,
} from '@/shared/types';
import { hullFieldValue, hullDataIndex } from './hull-fields';
import { isRowData } from '@/shared/lib/row-data';
import { schemaStringValue } from '@/domain/schema/schema-values';
import { mountedWeaponImages, type MountedWeaponImages } from '@/shared/lib/starsector/weapon-images';

export interface ImmersiveHullProjection {
  key: string;
  name: string;
  spec: DeepReadonly<RowData>;
  hull: DeepReadonly<Pick<JointHullProjection, 'sprite' | 'modules' | 'hints'>>;
  weapons: Array<MountedWeaponImages & { id: string; name: string; builtin: boolean }>;
  modules: Array<{ slot: DeepReadonly<RowData>; variant: ImmersiveHullProjection }>;
}

export function immersiveCatalogScene(entry: ReadonlyVariantEntry): ImmersiveHullProjection | null {
  const preview = entry.preview;
  if (!preview || !isRowData(preview.spec)) return null;
  return variantHullScene(preview.hull, preview.spec, entry.label, preview.specs);
}

function variantHullScene(
  hull: DeepReadonly<JointHullProjection>,
  spec: DeepReadonly<RowData>,
  name: string,
  specs: readonly DeepReadonly<JointPreviewSpec>[],
): ImmersiveHullProjection {
  return {
    key: hull.variantKey,
    name,
    spec,
    hull,
    weapons: hull.slots.filter(isRowData).map((slot) => {
      const id = hull.weapons[schemaStringValue(slot.id)] ?? '';
      const weapon = specs.find((spec) => spec.kind === 'weapon' && spec.id === id);
      const data = weapon && isRowData(weapon.data) ? weapon.data : {};
      const projectile = specs.find((spec) => spec.kind === 'projectile' && spec.id === schemaStringValue(data.projectileSpecId));
      return {
        ...mountedWeaponImages(
          data,
          weapon?.resourceRefs ?? {},
          projectile && isRowData(projectile.data) ? projectile.data : {},
          projectile?.resourceRefs ?? {},
          slot,
          hull.hints,
        ),
        id,
        name: id,
        builtin: Object.hasOwn(hull.builtInWeapons, schemaStringValue(slot.id)),
      };
    }),
    modules: [],
  };
}

export function immersiveSnapshotScene(snapshot: JointEditSnapshot, values: Record<string, JointValue>): ImmersiveHullProjection | null {
  if (!snapshot.hull) return null;
  const data = hullDataIndex(snapshot.records, values);
  const specs = snapshot.records.flatMap((record): DeepReadonly<JointPreviewSpec>[] =>
    record.target.kind === 'spec'
      ? [
          {
            kind: record.target.target.kind,
            id: record.target.target.id,
            data: data.get(record.key)!,
            resourceRefs: record.resourceRefs,
            source: record.source,
            sourceVersion: record.sourceVersion,
          },
        ]
      : [],
  );
  const scenes = Object.values({ ...snapshot.variants, [snapshot.hull.variantKey]: snapshot.hull }).map((hull) => {
    const binding = hull.fields.name;
    const name = [schemaStringValue(hullFieldValue(binding, data)), schemaStringValue(data.get(hull.variantKey)!.displayName)]
      .filter(Boolean)
      .join(' · ');
    return variantHullScene(hull, hull.skinKeys.length ? hull.spec : data.get(hull.hullKey)!, name, specs);
  });
  for (const scene of scenes)
    for (const module of scene.hull.modules) {
      const child = scenes.find((item) => item.key === module.variantKey),
        slot = scene.weapons.find((item) => item.slot.id === module.slotId)?.slot;
      if (child && slot) scene.modules.push({ slot, variant: child });
    }
  return scenes.find((scene) => scene.key === snapshot.hull!.variantKey)!;
}

export function immersiveHullPoint(location: readonly number[]): Point {
  return { x: -location[1]!, y: -location[0]! };
}
export function immersiveArcPath(angle: number, arc: number): string {
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
export function immersiveWingFormation(count: number, formation: string): Point[] {
  const offsets = (formations[formation as keyof typeof formations] ?? formations.default)[Math.min(6, count)]!;
  return Array.from({ length: offsets.length / 2 }, (_, index) => ({ x: offsets[index * 2]!, y: -offsets[index * 2 + 1]! }));
}
export interface ImmersiveWingLayout {
  points: Point[];
  spriteHeight: number;
  diagnostic: string;
}
export function immersiveWingLayout(count: number, formation: string, rendererSize: number): ImmersiveWingLayout {
  if (!Number.isInteger(count) || count < 0) return { points: [], spriteHeight: 0, diagnostic: '战机数量缺失或无效' };
  if (!['V', 'BOX', 'CLAW', 'DIAMOND'].includes(formation))
    return { points: [], spriteHeight: 0, diagnostic: '战机联队阵型缺失或无效：' + formation };
  const distance = rendererSize / 2;
  return {
    points: immersiveWingFormation(count, formation).map((point) => ({ x: point.x * distance, y: point.y * distance })),
    spriteHeight: 0.75 * distance * (1 - count / 15),
    diagnostic: '',
  };
}
