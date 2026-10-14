import type {
  JointEditSnapshot,
  JointValue,
  JointHullProjection,
  ResourceRef,
  RowData,
  JointVariantEntry,
  JointPreviewSpec,
  DeepReadonly,
} from '@/shared/types';
import { jointObject } from '@/domain/joint-edit';
import { isRowData } from '@/shared/lib/row-data';
import { schemaStringValue } from '@/domain/schema/schema-values';
import { weaponNumber, weaponStatistics } from './weapon-statistics';
import { variantModuleEntries, weaponSlotCompatibility, type HullmodCategory } from './variant-actions';
import type { ImmersiveField, ImmersiveStat } from './fields';
import { mountedWeaponImages, weaponImageLayers, weaponLoadedMissile, type MountedWeaponImages } from '@/domain/editors/weapon-images';
import { VARIANT_COLORS } from './appearance';

export interface VariantWeapon extends MountedWeaponImages {
  slot: RowData;
  type: string;
  id: string;
  name: string;
  builtin: boolean;
  flux: number;
  peakFlux: number;
  cost: number;
  diagnostic: string;
}
export interface VariantWing {
  index: number;
  id: string;
  name: string;
  count: number;
  cost: number;
  builtin: boolean;
  resource: ResourceRef | null;
}
export interface VariantHullmod {
  id: string;
  name: string;
  design: string;
  cost: number;
  category: HullmodCategory | 'builtin';
  strengthened: boolean;
  icon: ResourceRef | null;
}
export interface VariantProjection {
  key: string;
  role: string;
  id: string;
  name: string;
  source: string;
  editable: boolean;
  hull: JointHullProjection;
  spec: Readonly<RowData>;
  weapons: VariantWeapon[];
  wings: VariantWing[];
  mods: VariantHullmod[];
  stats: ImmersiveStat[];
  fields: ImmersiveStat[];
  allStats: ImmersiveStat[];
  opUsed: number;
  opTotal: number;
  capacity: number;
  dissipation: number;
  shieldFlux: number;
  vents: number;
  capacitors: number;
  fluxLimit: number;
  diagnostics: string[];
  engineStyles: Readonly<RowData>;
  engineResources: Record<string, ResourceRef>;
  modules: Array<{ slot: RowData; variant: VariantProjection }>;
}
export interface VariantPanel {
  kind: 'variant';
  heading: ImmersiveStat[];
  allStats: ImmersiveStat[];
  variants: VariantProjection[];
  resources: ResourceRef[];
}
export interface VariantSceneProjection {
  key: string;
  name: string;
  spec: DeepReadonly<RowData>;
  hull: Pick<JointHullProjection, 'sprite' | 'modules'>;
  weapons: Array<MountedWeaponImages & Pick<VariantWeapon, 'id' | 'name' | 'builtin'>>;
  modules: Array<{ slot: DeepReadonly<RowData>; variant: VariantSceneProjection }>;
  engineStyles: Readonly<RowData>;
  engineResources: Record<string, ResourceRef>;
}
export function variantCatalogScene(entry: JointVariantEntry): VariantSceneProjection | null {
  const preview = entry.preview;
  if (!preview || !isRowData(preview.spec)) return null;
  return variantHullScene(preview.hull, preview.spec, entry.label, preview.specs);
}
export function variantCandidateResources(entry: JointVariantEntry, kind: 'weapons' | 'wings'): ResourceRef[] {
  if (kind === 'wings') {
    const scene = variantCatalogScene(entry);
    return scene
      ? [
          ...(scene.hull.sprite ? [scene.hull.sprite] : []),
          ...scene.weapons.flatMap((weapon) => [
            ...weapon.layers.map((layer) => layer.resource),
            ...(weapon.loadedMissile ? [weapon.loadedMissile.resource] : []),
          ]),
        ]
      : [];
  }
  const spec = isRowData(entry.spec) ? entry.spec : {},
    projectile = entry.projectile && isRowData(entry.projectile.data) ? entry.projectile.data : {};
  const missile = weaponLoadedMissile(spec, projectile, entry.projectile?.resourceRefs ?? {}, 'turret');
  return [...weaponImageLayers(spec, entry.resourceRefs, 'turret').map((layer) => layer.resource), ...(missile ? [missile.resource] : [])];
}
function variantHullScene(
  hull: JointHullProjection,
  spec: DeepReadonly<RowData>,
  name: string,
  specs: DeepReadonly<JointPreviewSpec>[],
): VariantSceneProjection {
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
    engineStyles: {},
    engineResources: {},
  };
}
export function variantSnapshotScene(snapshot: JointEditSnapshot, values: Record<string, JointValue>): VariantSceneProjection | null {
  if (!snapshot.hull) return null;
  const data = (key: string) => jointObject(values[key] ?? snapshot.records.find((record) => record.key === key)?.value);
  const specs = snapshot.records.flatMap((record): DeepReadonly<JointPreviewSpec>[] =>
    record.target.kind === 'spec'
      ? [
          {
            kind: record.target.target.kind,
            id: record.target.target.id,
            data: data(record.key),
            resourceRefs: record.resourceRefs,
            source: record.source,
            sourceVersion: record.sourceVersion,
          },
        ]
      : [],
  );
  const scenes = Object.values({ ...snapshot.variants, [snapshot.hull.variantKey]: snapshot.hull }).map((hull) => {
    const binding = hull.fields.name;
    const name = [
      binding ? schemaStringValue(data(binding.recordKey)[binding.path]) : '',
      schemaStringValue(data(hull.variantKey).displayName),
    ]
      .filter(Boolean)
      .join(' · ');
    return variantHullScene(hull, data(hull.hullKey), name, specs);
  });
  for (const scene of scenes)
    for (const module of scene.hull.modules) {
      const child = scenes.find((item) => item.key === module.variantKey),
        slot = scene.weapons.find((item) => item.slot.id === module.slotId)?.slot;
      if (child && slot) scene.modules.push({ slot, variant: child });
    }
  return scenes.find((scene) => scene.key === snapshot.hull!.variantKey)!;
}
export const formatVariantNumber = (value: number) =>
  Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, useGrouping: false }).format(value) : '来源未确定';
export function variantOpSegments(used: number, total: number): { within: number; overflow: number } {
  if (!Number.isFinite(used) || !Number.isFinite(total) || (used === 0 && total === 0)) return { within: 0, overflow: 0 };
  return used > total ? { within: total / used, overflow: (used - total) / used } : { within: used / total, overflow: 0 };
}
export function variantEditableRecords(snapshot: JointEditSnapshot): string[] {
  const root = snapshot.bindings.variant ?? snapshot.bindings.spec!;
  const keys = new Set([root]);
  const pending = [root];
  while (pending.length) {
    const key = pending.pop()!;
    const data = jointObject(snapshot.records.find((record) => record.key === key)?.value);
    for (const [, id] of variantModuleEntries(data.modules)) {
      const target = snapshot.records.find(
        (record) => record.target.kind === 'spec' && record.target.target.kind === 'variant' && record.target.target.id === id,
      );
      if (target && !keys.has(target.key)) {
        keys.add(target.key);
        pending.push(target.key);
      }
    }
  }
  return [...keys];
}
function variantRecordRoles(snapshot: JointEditSnapshot): Map<string, string> {
  const root = snapshot.bindings.variant ?? snapshot.bindings.spec!;
  const roles = new Map([[root, 'variant']]),
    pending = [root];
  while (pending.length) {
    const key = pending.shift()!,
      data = jointObject(snapshot.records.find((record) => record.key === key)?.value);
    for (const [slot, id] of variantModuleEntries(data.modules)) {
      const target = snapshot.records.find(
        (record) => record.target.kind === 'spec' && record.target.target.kind === 'variant' && record.target.target.id === id,
      );
      if (target && !roles.has(target.key)) {
        roles.set(target.key, roles.get(key) + '/' + slot);
        pending.push(target.key);
      }
    }
  }
  return roles;
}
export function projectVariantPanel(
  snapshot: JointEditSnapshot,
  values: Record<string, JointValue>,
  projection: JointEditSnapshot | null = snapshot,
): VariantPanel {
  const graph = projection ?? snapshot;
  const roles = variantRecordRoles(graph);
  const data = (key: string) => jointObject(values[key] ?? graph.records.find((record) => record.key === key)?.value);
  const csv = (table: string, id: string) =>
    graph.records.find((record) => record.target.kind === 'csv' && record.target.table === table && record.target.identity.id === id);
  const specRecord = (kind: string, id: string) =>
    graph.records.find((record) => record.target.kind === 'spec' && record.target.target.kind === kind && record.target.target.id === id);
  const editableKeys = variantEditableRecords(graph),
    rootKey = graph.bindings.variant ?? graph.bindings.spec;
  const variants = Object.values(graph.variants)
    .filter((hull) => editableKeys.includes(hull.variantKey))
    .sort((a, b) => Number(b.variantKey === rootKey) - Number(a.variantKey === rootKey))
    .map((hull): VariantProjection => {
      const key = hull.variantKey,
        role = roles.get(key)!,
        variant = data(key),
        spec = data(hull.hullKey);
      const record = graph.records.find((item) => item.key === key)!;
      const fieldValue = (name: string) => {
        const binding = hull.fields[name];
        return binding ? data(binding.recordKey)[binding.path] : undefined;
      };
      const number = (name: string, fallback = 0) => weaponNumber({ [name]: fieldValue(name) ?? '' }, name, fallback);
      const hullSize = schemaStringValue(spec.hullSize);
      const field = (name: string, label: string, type: ImmersiveField['schema']['type']): ImmersiveField => ({
        id: role + '/' + name,
        recordKey: key,
        schema: { key: name, label, type, ...(type === 'integer' ? { min: 0 } : {}) },
      });
      const vf = (name: string, label: string, type: ImmersiveField['schema']['type'] = 'string'): ImmersiveStat => ({
        id: role + '/' + name,
        label,
        display: schemaStringValue(variant[name]),
        fields: [field(name, label, type)],
      });
      const name = vf('displayName', '装配名称');
      name.font = 'ship-title';
      name.display = [schemaStringValue(fieldValue('name')), schemaStringValue(variant.displayName)].filter(Boolean).join(' · ');
      const hullField = vf('hullId', '舰体／Skin', 'enum');
      hullField.fields[0]!.schema.source = 'hull:ids';
      hullField.fields[0]!.schema.required = true;
      hullField.fields[0]!.handoff = true;
      const fields = [name, hullField, vf('fluxCapacitors', '幅能容器', 'integer'), vf('fluxVents', '幅能耗散器', 'integer')];
      fields[2]!.font = 'ship-title';
      fields[3]!.font = 'ship-title';
      const weapons = hull.slots.filter(isRowData).map((slot): VariantWeapon => {
        const id = hull.weapons[schemaStringValue(slot.id)] ?? '';
        const item = specRecord('weapon', id),
          weapon = jointObject(item?.value),
          row = csv('weapons', id),
          weaponCsv = jointObject(row?.value);
        const projectile = specRecord('projectile', schemaStringValue(weapon.projectileSpecId));
        const statistics = weaponStatistics(weaponCsv, weapon, jointObject(projectile?.value));
        const builtin = Object.hasOwn(hull.builtInWeapons, schemaStringValue(slot.id));
        return {
          ...mountedWeaponImages(
            weapon,
            item?.resourceRefs ?? {},
            jointObject(projectile?.value),
            projectile?.resourceRefs ?? {},
            slot,
            hull.hints,
          ),
          slot,
          type: schemaStringValue(weapon.type),
          id,
          name: schemaStringValue(weaponCsv.name) || id,
          builtin,
          flux: id ? statistics.sustainedFlux : 0,
          peakFlux: id ? statistics.fluxPerSecond : 0,
          cost: builtin || !id ? 0 : weaponNumber(weaponCsv, 'OPs', NaN),
          diagnostic: id
            ? !item || item.value.state === 'missing' || !row || row.value.state === 'missing'
              ? '武器来源缺失：' + id
              : builtin
                ? ''
                : weaponSlotCompatibility(slot, weapon)
            : '',
        };
      });
      const fitted = Array.isArray(variant.wings) ? variant.wings : [];
      const bays = Math.max(Math.trunc(number('fighter bays')), hull.builtInWings.length, fitted.length);
      const wings = Array.from({ length: bays }, (_, index): VariantWing => {
        const builtin = Boolean(hull.builtInWings[index]),
          id = hull.builtInWings[index] || schemaStringValue(fitted[index]);
        const row = csv('wings', id),
          wing = jointObject(row?.value),
          wingVariant = specRecord('variant', schemaStringValue(wing.variant));
        const fighterHull = graph.variants[wingVariant?.key ?? ''];
        const nameSource = fighterHull?.fields.name;
        const fighterName = nameSource ? schemaStringValue(data(nameSource.recordKey)[nameSource.path]) : '';
        return {
          index,
          id,
          name: [fighterName, schemaStringValue(jointObject(wingVariant?.value).displayName)].filter(Boolean).join(' ') || id || '空甲板',
          count: weaponNumber(wing, 'num', 1),
          cost: builtin || !id ? 0 : weaponNumber(wing, 'op cost', NaN),
          builtin,
          resource: fighterHull?.sprite ?? null,
        };
      });
      const strings = (name: string) =>
        Array.isArray(variant[name]) ? variant[name].filter((id): id is string => typeof id === 'string') : [];
      const permanent = strings('permaMods'),
        sMods = strings('sMods'),
        strengthened = strings('sModdedBuiltIns');
      const ids = [...new Set([...hull.builtInMods, ...strings('hullMods'), ...permanent, ...sMods])];
      const costField =
        (
          { FRIGATE: 'cost_frigate', DESTROYER: 'cost_dest', CRUISER: 'cost_cruiser', CAPITAL_SHIP: 'cost_capital' } as Record<
            string,
            string
          >
        )[hullSize] ?? 'cost_frigate';
      const mods = ids.map((id): VariantHullmod => {
        const row = csv('hullmods', id),
          mod = jointObject(row?.value);
        const category = hull.builtInMods.includes(id)
          ? 'builtin'
          : sMods.includes(id)
            ? 's'
            : permanent.includes(id)
              ? 'permanent'
              : 'normal';
        return {
          id,
          name: schemaStringValue(mod.name) || id,
          design: schemaStringValue(mod['tech/manufacturer']),
          category,
          strengthened: strengthened.includes(id),
          cost: category === 'normal' ? weaponNumber(mod, costField, NaN) : 0,
          icon: row?.resourceRefs.icon ?? null,
        };
      });
      const vents = weaponNumber(variant, 'fluxVents', 0),
        capacitors = weaponNumber(variant, 'fluxCapacitors', 0);
      const settings = graph.referenceSettings.values;
      const capacity = number('max flux') + capacitors * weaponNumber(settings, 'fluxPerCapacitor', 200);
      const dissipation = number('flux dissipation') + vents * weaponNumber(settings, 'dissipationPerVent', 10);
      const stat = (id: string, label: string, value: number, formula: string): ImmersiveStat => ({
        id: role + '/' + id,
        label,
        display: formatVariantNumber(value),
        fields: [],
        formula,
        font: 'op',
        displayRuns: [
          {
            text: formatVariantNumber(value),
            color: ['speed', 'capacity', 'dissipation', 'efficiency'].includes(id) ? VARIANT_COLORS.positive : VARIANT_COLORS.value,
          },
        ],
      });
      const stats = [
        stat('speed', '最高速度', number('max speed'), '有效舰体 max speed'),
        stat('armor', '装甲', number('armor rating'), '舰船 CSV armor rating'),
        stat('hull', '结构', number('hitpoints'), '舰船 CSV hitpoints'),
      ];
      stats.push(
        stat('capacity', '幅能容量', capacity, '有效舰体 max flux + 容器 × fluxPerCapacitor'),
        stat('dissipation', '幅能耗散', dissipation, '有效舰体 flux dissipation + 耗散器 × dissipationPerVent'),
      );
      const shield = schemaStringValue(fieldValue('shield type'));
      const shieldFlux = shield === 'FRONT' || shield === 'OMNI' ? number('shield upkeep') * number('flux dissipation') : 0;
      if (shield === 'FRONT' || shield === 'OMNI')
        stats.push(
          stat('arc', '护盾角度', number('shield arc'), '有效舰体 shield arc'),
          stat('upkeep', '护盾每秒幅能', shieldFlux, 'shield upkeep × 舰体基础 flux dissipation'),
          stat('efficiency', '护盾幅能/伤害', number('shield efficiency', 1), '有效舰体 shield efficiency'),
        );
      stats.push(
        stat(
          'weapon-flux',
          '武器每秒幅能',
          weapons.reduce((sum, weapon) => sum + weapon.flux, 0),
          weapons
            .filter((weapon) => weapon.id)
            .map((weapon) => `${weapon.name}：持续 ${formatVariantNumber(weapon.flux)}，峰值 ${formatVariantNumber(weapon.peakFlux)}`)
            .join('\n'),
        ),
      );
      const opUsed =
        vents +
        capacitors +
        weapons.reduce((sum, weapon) => sum + weapon.cost, 0) +
        wings.reduce((sum, wing) => sum + wing.cost, 0) +
        mods.reduce((sum, mod) => sum + mod.cost, 0);
      const opTotal = number('ordnance points'),
        fluxLimit = ({ FIGHTER: 5, FRIGATE: 10, DESTROYER: 20, CRUISER: 30, CAPITAL_SHIP: 50 } as Record<string, number>)[hullSize] ?? 100;
      const diagnostics = weapons
        .filter((weapon) => weapon.diagnostic)
        .map((weapon) => `${schemaStringValue(weapon.slot.id)}：${weapon.diagnostic}`);
      for (const recordKey of new Set([hull.hullKey, ...Object.values(hull.fields).map((field) => field.recordKey)])) {
        const source = graph.records.find((entry) => entry.key === recordKey)!;
        if (source.value.state === 'missing')
          diagnostics.push('舰体来源缺失：' + (source.target.kind === 'spec' ? source.target.target.write.path : source.target.write.path));
      }
      for (const wing of wings)
        if (wing.id && !Number.isFinite(wing.cost)) diagnostics.push('甲板 ' + (wing.index + 1) + '：联队来源缺失 ' + wing.id);
      for (const mod of mods)
        if (!csv('hullmods', mod.id) || csv('hullmods', mod.id)!.value.state === 'missing') diagnostics.push('插件来源缺失：' + mod.id);
      if (opUsed > opTotal) diagnostics.push(`装配点超预算：${opUsed}/${opTotal}`);
      if (vents > fluxLimit || capacitors > fluxLimit) diagnostics.push(`幅能分配超过舰级基础上限 ${fluxLimit}`);
      if (!Number.isFinite(opUsed)) diagnostics.push('装配点来源未确定，查看缺失装备／插件记录');
      return {
        key,
        role,
        id: schemaStringValue(variant.variantId),
        name: [schemaStringValue(fieldValue('name')), schemaStringValue(variant.displayName)].filter(Boolean).join(' · '),
        source: record.source?.path ?? (record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path),
        editable: record.source?.source !== 'core',
        hull,
        spec,
        weapons,
        wings,
        mods,
        stats,
        fields,
        allStats: [...stats, ...fields],
        opUsed,
        opTotal,
        capacity,
        dissipation,
        shieldFlux,
        vents,
        capacitors,
        fluxLimit,
        diagnostics,
        engineStyles: isRowData(graph.referenceSettings.values.engineStyles) ? graph.referenceSettings.values.engineStyles : {},
        engineResources: graph.referenceSettings.resources,
        modules: [],
      };
    });
  for (const variant of variants)
    for (const module of variant.hull.modules) {
      const child = variants.find((item) => item.key === module.variantKey),
        slot = variant.weapons.find((item) => item.slot.id === module.slotId)?.slot;
      if (child && slot) variant.modules.push({ slot, variant: child });
      else variant.diagnostics.push('模块 ' + module.slotId + '：装配或槽位来源缺失');
    }
  return {
    kind: 'variant',
    heading: variants[0]?.fields.slice(0, 1) ?? [],
    allStats: variants.flatMap((variant) => variant.allStats),
    variants,
    resources: variants.flatMap((variant) => [
      ...(variant.hull.sprite ? [variant.hull.sprite] : []),
      ...variant.weapons.flatMap((weapon) => weapon.layers.map((layer) => layer.resource)),
      ...variant.wings.flatMap((wing) => (wing.resource ? [wing.resource] : [])),
      ...variant.mods.flatMap((mod) => (mod.icon ? [mod.icon] : [])),
    ]),
  };
}
