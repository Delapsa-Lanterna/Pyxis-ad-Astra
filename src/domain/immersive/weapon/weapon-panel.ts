import { immersiveNumber, updateImmersiveField } from '../fields';
import { changeWeaponSpecClass } from '@/domain/editors/weapon-spec';
import type { JointEditSnapshot, JointValue, ResourceRef } from '@/shared/types';
import type { ImmersiveField, ImmersiveStat } from '../fields';
import { immersiveSourceRecords } from '../source-records';
import { jointObject } from '@/domain/joint-edit';
import { getCsvColumnSchemas } from '@/domain/schema/csv-schema-registry';
import { schemaStringValue } from '@/domain/schema/schema-values';
import { weaponStatistics, weaponAccuracy, weaponTurnRate, weaponMissileSpeed, weaponMissileTracking } from './weapon-statistics';
import { weaponImageLayers, weaponLoadedMissile } from '@/domain/editors/weapon-images';
import { designTypeColor } from '../design-type';

export const WEAPON_TYPE_LABELS: Record<string, string> = {
  BALLISTIC: '实弹',
  ENERGY: '能量',
  MISSILE: '导弹',
  HYBRID: '混合',
  COMPOSITE: '复合',
  SYNERGY: '协同',
  UNIVERSAL: '通用',
  SYSTEM: '系统',
  DECORATIVE: '装饰',
};
export const WEAPON_SIZE_LABELS: Record<string, string> = { SMALL: '小型', MEDIUM: '中型', LARGE: '大型' };
const DAMAGE: Record<string, { label: string; armor: number; shield: number }> = {
  KINETIC: { label: '动能', armor: 50, shield: 200 },
  HIGH_EXPLOSIVE: { label: '高爆', armor: 200, shield: 50 },
  ENERGY: { label: '能量', armor: 100, shield: 100 },
  FRAGMENTATION: { label: '破片', armor: 25, shield: 25 },
  OTHER: { label: '其他', armor: 100, shield: 100 },
};
export const weaponDamageLabel = (type: string) => DAMAGE[type]?.label ?? type;
const format = (value: number) =>
  Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, useGrouping: false }).format(value) : '来源数值无效';
function customWeaponText(text: string, highlights: string): string {
  if (!highlights) return text;
  const parameters = highlights.split('|').map((value) => value.trim());
  let index = 0;
  return text.replace(/%%|%n|%(?:(\d+)\$)?s/g, (token, position: string | undefined) => {
    if (token === '%%') return '%';
    if (token === '%n') return '\n';
    return parameters[position ? Number(position) - 1 : index++] ?? token;
  });
}
export interface WeaponPanel {
  kind: 'weapon';
  heading: ImmersiveStat[];
  description: ImmersiveStat;
  primary: ImmersiveStat[];
  ancillary: ImmersiveStat[];
  primarySettings: ImmersiveStat;
  ancillarySettings: ImmersiveStat;
  branch: ImmersiveStat;
  projectile: ImmersiveStat | null;
  customPrimary: string;
  customPrimaryHL: string;
  customAncillary: string;
  customAncillaryHL: string;
  damageDescription: string;
  damageType: string;
  damageIcon: ResourceRef | null;
  iconLayers: Array<{ resource: ResourceRef; origin: { x: number; y: number } }>;
  mountType: string;
  mountSize: string;
  loadedMissile: { resource: ResourceRef; size: [number, number]; center: [number, number]; offsets: number[]; angles: number[] } | null;
  diagnostic: string;
  allStats: ImmersiveStat[];
}

export function projectWeaponPanel(
  snapshot: JointEditSnapshot,
  values: Record<string, JointValue>,
  projection: JointEditSnapshot | null = snapshot,
): WeaponPanel {
  const sources = immersiveSourceRecords(snapshot),
    csv = jointObject(values[sources.csv.key]),
    spec = jointObject(values[sources.spec.key]),
    description = jointObject(values[sources.description.key]);
  const columns = getCsvColumnSchemas('weapons');
  const cf = (key: string, label = columns.find((column) => column.key === key)?.label ?? key): ImmersiveField => {
    const column = columns.find((column) => column.key === key);
    return {
      id: 'csv/' + key,
      recordKey: sources.csv.key,
      schema: {
        key,
        label,
        type:
          column?.control === 'number'
            ? 'float'
            : column?.control === 'boolean'
              ? 'boolean'
              : column?.control === 'enum' || column?.source
                ? 'enum'
                : 'string',
        options: column?.options,
        source: column?.source,
      },
    };
  };
  const sf = (key: string, label: string, options?: string[]): ImmersiveField => ({
    id: 'spec/' + key,
    recordKey: sources.spec.key,
    schema: { key, label, type: options ? 'enum' : 'string', options },
    optionLabels: {
      ...WEAPON_TYPE_LABELS,
      ...WEAPON_SIZE_LABELS,
      projectile: '弹体 projectile',
      beam: '光束 beam',
      ALTERNATING: '交替',
      ALTERNATING_BURST: '交替连射',
      DUAL: '双发',
      LINKED: '齐射',
      true: '启用',
      false: '关闭',
    },
  });
  const n = (key: string, fallback = 0) => immersiveNumber(csv, key, fallback);
  const association = projection?.records.find((record) => record.key === projection.bindings.projectile);
  const projectile = jointObject(association?.value);
  const stats = weaponStatistics(csv, spec, projectile);
  const stat = (id: string, label: string, display: string, fields: ImmersiveField[], formula?: string): ImmersiveStat => ({
    id,
    label,
    display,
    fields,
    formula,
  });
  const num = (key: string, label: string, fallback = 0) => stat(key, label, format(n(key, fallback)), [cf(key, label)]);
  const heading = [
    stat('name', '武器名称', schemaStringValue(csv.name) || '名称未提供', [cf('name')]),
    stat('manufacturer', '设计类型', schemaStringValue(csv['tech/manufacturer']) || 'Common', [cf('tech/manufacturer')]),
  ];
  const desc = stat(
    'description',
    '武器描述',
    schemaStringValue(description.text1) || '描述未提供',
    [1, 2, 3, 4, 5].map((index) => ({
      id: 'description/text' + index,
      recordKey: sources.description.key,
      schema: { key: 'text' + index, label: '描述 text' + index, type: 'text' },
    })),
  );
  const primarySettings = stat('primary-settings', '原始数据显示设置', '编辑', [
    cf('noDPSInTooltip'),
    cf('tags'),
    cf('customPrimary'),
    cf('customPrimaryHL'),
  ]);
  const ancillarySettings = stat('ancillary-settings', '辅助数据显示设置', '编辑', [
    cf('tags'),
    cf('customAncillary'),
    cf('customAncillaryHL'),
  ]);
  const tags = schemaStringValue(csv.tags)
    .split(',')
    .map((tag) => tag.trim());
  const role = stat(
    'role',
    '战术应用',
    schemaStringValue(csv.primaryRoleStr) || schemaStringValue(description.text2) || '未提供',
    [cf('primaryRoleStr'), desc.fields[1]!],
    'primaryRoleStr 优先于 WEAPON 描述 text2。',
  );
  const mount = stat(
    'mount',
    '安装类型',
    `${WEAPON_SIZE_LABELS[schemaStringValue(spec.size)] ?? schemaStringValue(spec.size)}，${WEAPON_TYPE_LABELS[schemaStringValue(spec.mountTypeOverride) || schemaStringValue(spec.type)] ?? schemaStringValue(spec.type)}`,
    [
      sf('size', '尺寸', Object.keys(WEAPON_SIZE_LABELS)),
      sf('type', '武器类型', Object.keys(WEAPON_TYPE_LABELS)),
      sf('mountTypeOverride', '挂载覆盖类型', Object.keys(WEAPON_TYPE_LABELS)),
    ],
  );
  const cycleFields = [cf('chargeup'), cf('chargedown'), cf('burst size'), cf('burst delay')];
  const shotFields = [
    cf('damage/shot'),
    ...cycleFields,
    sf('barrelMode', '发射模式', ['ALTERNATING', 'ALTERNATING_BURST', 'DUAL', 'LINKED']),
    { ...sf('turretOffsets', '炮塔发射点'), schema: { key: 'turretOffsets', label: '炮塔发射点', type: 'array' as const } },
  ];
  const beamFields = [cf('damage/second'), ...cycleFields, sf('beamFireOnlyOnFullCharge', '仅满充能开火', ['true', 'false'])];
  beamFields.at(-1)!.schema.type = 'boolean';
  const damageFields = stats.beam ? beamFields : shotFields;
  const count = stats.barrels * (spec.interruptibleBurst ? 1 : stats.burst);
  const showCount = count > 1 && stats.ammo > count && count < 1000;
  const primary = [role, mount, num('OPs', '装配点数'), num('range', '武器射程', 250)];
  if (!stats.beam || (stats.burstDamage >= 0 && !spec.skipIdleFrameIfZeroBurstDelay) || tags.includes('damage_special'))
    primary.push(
      stat(
        'damage',
        '伤害',
        tags.includes('damage_special')
          ? '特殊'
          : format(stats.beam ? stats.burstDamage : stats.damage) + (!stats.beam && showCount ? ` × ${format(count)}` : ''),
        damageFields,
      ),
    );
  const noDps = csv.noDPSInTooltip === true || schemaStringValue(csv.noDPSInTooltip).toLowerCase() === 'true';
  if (!noDps)
    primary.push(
      stat(
        'dps',
        '伤害 / 秒',
        format(stats.dps) + (stats.dps !== stats.sustained ? `（持续 ${format(stats.sustained)}）` : ''),
        [...damageFields, cf('ammo'), cf('ammo/sec')],
        stats.beam
          ? '光束伤害按充能、持续、衰减与冷却周期计算；持续光束使用 damage/second。'
          : 'DPS = damage/shot × 发射数量 ÷（chargeup + chargedown + burst delay × (burst size − 1)）。',
      ),
    );
  if (stats.empSource > 0) {
    const burstBeam = stats.beam && stats.burst > 0 && !spec.skipIdleFrameIfZeroBurstDelay;
    primary.push(
      stat(
        'emp',
        stats.beam && !burstBeam ? 'EMP 每秒' : 'EMP 损害',
        format(burstBeam ? (stats.burstDamage * stats.empSource) / n('damage/second') : stats.empSource) +
          (!stats.beam && showCount ? ` × ${format(count)}` : ''),
        [cf('emp'), ...cycleFields],
      ),
    );
  }
  const fluxFields = [cf('energy/second'), ...(stats.beam ? [] : [cf('energy/shot')]), ...damageFields];
  if (stats.sustainedFlux > 0) {
    if (!noDps)
      primary.push(
        stat(
          'flux-second',
          '幅能 / 秒',
          format(stats.fluxPerSecond) + (stats.dps !== stats.sustained ? `（持续 ${format(stats.sustainedFlux)}）` : ''),
          fluxFields,
          '每秒幅能 = DPS × 幅能／伤害。',
        ),
      );
    if (!stats.beam) primary.push(num('energy/shot', '幅能 / 每发射弹'));
    primary.push(
      stat(
        'flux-damage',
        '幅能 / 伤害',
        format(stats.fluxRatio),
        fluxFields,
        '弹体：充能幅能与整轮射击幅能 ÷ 整轮非 EMP 伤害；光束：使用所属光束周期。',
      ),
    );
  } else primary.push(stat('no-flux', '开火幅能', '不会产生幅能', [cf('energy/shot'), cf('energy/second')]));
  const damageTypeId = Object.hasOwn(DAMAGE, schemaStringValue(csv.type)) ? schemaStringValue(csv.type) : 'OTHER';
  const damageType = DAMAGE[damageTypeId]!;
  const ancillary = [stat('damage-type', '伤害类型', damageType.label, [cf('type')])];
  const overrideStat = (id: string, label: string, computed: string, fields: ImmersiveField[], override: string) =>
    stat(
      id,
      label,
      schemaStringValue(csv[override]) || computed,
      [cf(override), ...fields],
      `${override} 非空时采用原文；清空后采用来源参数的原版等级。`,
    );
  if (projectile.specClass === 'missile') {
    const speed = n('proj speed');
    ancillary.push(
      overrideStat('speed', '飞行速度', weaponMissileSpeed(speed), [cf('proj speed'), cf('launch speed'), cf('flight time')], 'speedStr'),
    );
    ancillary.push(overrideStat('tracking', '追踪能力', weaponMissileTracking(speed, projectile), [cf('proj speed')], 'trackingStr'));
    ancillary.push(num('proj hitpoints', '弹体结构值', 1));
  } else {
    ancillary.push(
      overrideStat(
        'accuracy',
        '精确度',
        stats.beam ? '完美' : weaponAccuracy(n('max spread')),
        [cf('min spread'), cf('max spread'), cf('spread/shot'), cf('spread decay/sec')],
        'accuracyStr',
      ),
    );
    ancillary.push(overrideStat('turn', '转向速度', weaponTurnRate(n('turn rate')), [cf('turn rate')], 'turnRateStr'));
  }
  if (stats.ammo < 2147483647) {
    ancillary.push(
      num(
        'ammo',
        schemaStringValue(spec.type) === 'ENERGY' ? (stats.regen > 0 ? '最大充能量' : '充能') : stats.regen > 0 ? '最大备弹量' : '备弹量',
        2147483647,
      ),
    );
    if (stats.regen > 0) {
      ancillary.push(
        stat(
          'reload-time',
          schemaStringValue(spec.type) === 'ENERGY' ? '秒 / 回充' : '秒 / 重装',
          format(stats.reload / stats.regen) + ' 秒',
          [cf('ammo/sec'), cf('reload size')],
          '装填时间 = reload size ÷ ammo/sec。',
        ),
      );
      ancillary.push(num('reload size', schemaStringValue(spec.type) === 'ENERGY' ? '单次回充量' : '单次装填量', 1));
    }
  }
  if (!stats.beam)
    ancillary.push(
      stat(
        'refire',
        '开火间隔',
        format(stats.refire) + ' 秒',
        cycleFields,
        '弹体使用原版充能、连射与再次射击周期；interruptibleBurst 使用 chargedown。',
      ),
    );
  const branch = stat('branch', '规格分支', schemaStringValue(spec.specClass) || '请选择规格分支', [
    {
      ...sf('specClass', '规格分支', ['projectile', 'beam']),
      schema: { key: 'specClass', label: '规格分支', type: 'enum', options: ['projectile', 'beam'], required: true },
    },
  ]);
  const projectileStat = stats.beam
    ? null
    : stat('projectile', '弹体来源', schemaStringValue(spec.projectileSpecId) || '引用未提供', [sf('projectileSpecId', '弹体引用')]);
  const hints = Array.isArray(spec.renderHints) ? spec.renderHints : [];
  const layers = weaponImageLayers(
    spec,
    projection?.records.find((record) => record.key === projection.bindings.spec)?.resourceRefs ?? {},
    'turret',
  );
  const standardIds = new Set(['range', 'damage', 'dps', 'emp']);
  const visiblePrimary = tags.includes('no_standard_data') ? primary.filter((stat) => !standardIds.has(stat.id)) : primary;
  const visibleAncillary = tags.includes('no_standard_data') ? [] : ancillary;
  const loadedHint = hints.some((hint) => hint === 'RENDER_LOADED_MISSILES' || hint === 'RENDER_LOADED_MISSILES_UNLESS_HIDDEN');
  const loadedMissile = weaponLoadedMissile(spec, projectile, association?.resourceRefs ?? {}, 'turret');
  heading[0]!.font = 'heading';
  primarySettings.font = 'heading';
  ancillarySettings.font = 'heading';
  branch.font = 'heading';
  heading[1]!.inline = true;
  heading[1]!.displayRuns = [{ text: heading[1]!.display, color: designTypeColor(projection ?? snapshot, heading[1]!.display) }];
  for (const entry of visiblePrimary)
    entry.gapBefore = ['range', 'flux-second', 'no-flux'].includes(entry.id) || (noDps && entry.id === 'energy/shot');
  for (const entry of visibleAncillary) entry.gapBefore = ['speed', 'accuracy', 'ammo', 'refire'].includes(entry.id);
  const customPrimaryHL = schemaStringValue(csv.customPrimaryHL).replaceAll('{x}', '×');
  const customAncillaryHL = schemaStringValue(csv.customAncillaryHL).replaceAll('{x}', '×');
  return {
    kind: 'weapon',
    heading,
    description: desc,
    primary: visiblePrimary,
    ancillary: visibleAncillary,
    primarySettings,
    ancillarySettings,
    branch,
    projectile: projectileStat,
    customPrimary: customWeaponText(schemaStringValue(csv.customPrimary), customPrimaryHL),
    customPrimaryHL,
    customAncillary: customWeaponText(schemaStringValue(csv.customAncillary), customAncillaryHL),
    customAncillaryHL,
    damageDescription:
      `${damageType.armor}% 对装甲，${damageType.shield}% 对护盾` + (stats.beam || tags.includes('damage_soft_flux') ? '；产生软幅能' : ''),
    damageType: damageTypeId,
    damageIcon: projection?.records.find((record) => record.key === projection.bindings.csv)?.resourceRefs.damageIcon ?? null,
    iconLayers: layers,
    mountType: schemaStringValue(spec.mountTypeOverride) || schemaStringValue(spec.type),
    mountSize: schemaStringValue(spec.size),
    loadedMissile,
    diagnostic:
      stats.diagnostics ||
      (loadedHint && !loadedMissile ? '已装载导弹的贴图、尺寸、中心或发射点来源缺失。' : '') ||
      (!stats.beam && !association?.source ? '弹体来源未提供，统计采用可读取的静态参数。' : ''),
    allStats: [
      ...heading,
      desc,
      ...primary,
      ...ancillary,
      primarySettings,
      ancillarySettings,
      branch,
      ...(projectileStat ? [projectileStat] : []),
    ],
  };
}

export function updateImmersiveWeaponField(...args: Parameters<typeof updateImmersiveField>): Record<string, JointValue> {
  const [, record, field, update] = args;
  const after = updateImmersiveField(...args);
  if (
    record.target.kind === 'spec' &&
    record.target.target.kind === 'weapon' &&
    field.schema.key === 'specClass' &&
    update.kind === 'set' &&
    (update.value === 'projectile' || update.value === 'beam')
  )
    return { ...after, [record.key]: { state: 'present', value: changeWeaponSpecClass(jointObject(after[record.key]), update.value) } };
  return after;
}
