import type { HullReferencesResult, HullReferenceOption, SourceOptionGroup } from '@/shared/types';
import type { DeepReadonly } from '@/shared/types';

export function hullReferenceOptions(
  result: DeepReadonly<HullReferencesResult>,
): Pick<DeepReadonly<HullReferenceOption>, 'label' | 'value' | 'resourceRef'>[] {
  return result.groups.flatMap((group) =>
    group.options.map((option) => ({
      label: option.label,
      value: option.value,
      resourceRef: option.resourceRef,
    })),
  );
}

export function hullReferenceSourceGroups(result: DeepReadonly<HullReferencesResult>): SourceOptionGroup[] {
  return result.groups.map((group) => ({
    origin: group.origin,
    reference: group.reference,
    options: group.options.map((option) => ({ ...option, description: null })),
  }));
}

export type HullSlotKind = 'builtInWeaponSlots' | 'weaponSlots' | 'moduleSlots';

const SLOT_LABELS: Record<string, string> = {
  SMALL: '小型',
  MEDIUM: '中型',
  LARGE: '大型',
  BALLISTIC: '实弹',
  ENERGY: '能量',
  MISSILE: '导弹',
  HYBRID: '混合',
  SYNERGY: '协同',
  COMPOSITE: '复合',
  UNIVERSAL: '通用',
  STATION_MODULE: '模块',
  BUILT_IN: '内置',
  DECORATIVE: '装饰',
  SYSTEM: '系统',
  LAUNCH_BAY: '机库',
  HARDPOINT: '固定',
  TURRET: '炮塔',
  HIDDEN: '隐藏',
};

export function hullWeaponSlotOptions(
  result: DeepReadonly<HullReferencesResult>,
  hullId: string,
  kind: HullSlotKind = 'builtInWeaponSlots',
): SourceOptionGroup[] {
  return (['mod', 'reference', 'core'] as const)
    .map((origin) => ({
      origin,
      options: (result[kind][hullId] ?? [])
        .filter((slot) => slot.origin === origin)
        .map((slot) => ({
          value: slot.id,
          label: [
            slot.id,
            ...[slot.type, slot.size, slot.mount].map((value) => value && (SLOT_LABELS[value] ?? value)).filter(Boolean),
          ].join(' · '),
          origin: slot.origin,
          description: null,
          resourceRef: null,
        })),
    }))
    .filter((group) => group.options.length > 0);
}
