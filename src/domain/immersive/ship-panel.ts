import type { JointEditSnapshot, JointValue, ResourceRef } from '@/shared/types';
import type { ImmersiveField, ImmersiveStat } from './fields';
import { jointObject } from '@/domain/joint-edit';
import { shipSourceRecords } from './ship-sources';
import { getCsvColumnSchemas } from '@/domain/schema/schema-registry';
import { schemaStringValue } from '@/domain/schema/schema-values';
import { parseInputNumber } from '@/shared/lib/input-number';

export interface ShipImmersivePanel {
  heading: ImmersiveStat[];
  description: ImmersiveStat;
  logistics: ImmersiveStat[][];
  combat: ImmersiveStat[];
  system: ImmersiveStat;
  systemDescription: string;
  mounts: string;
  armaments: string;
  hullmods: Array<{ id: string; name: string; description: string }>;
  sprite: ResourceRef | null;
  allStats: ImmersiveStat[];
}

const HULL_SIZE_LABELS: Record<string, string> = {
  FIGHTER: '战机',
  FRIGATE: '护卫舰',
  DESTROYER: '驱逐舰',
  CRUISER: '巡洋舰',
  CAPITAL_SHIP: '主力舰',
};
const SIZE_LABELS: Record<string, string> = { SMALL: '小型', MEDIUM: '中型', LARGE: '大型' };
const MOUNT_LABELS: Record<string, string> = {
  BALLISTIC: '实弹',
  ENERGY: '能量',
  MISSILE: '导弹',
  HYBRID: '混合',
  COMPOSITE: '复合',
  SYNERGY: '协同',
  UNIVERSAL: '通用',
};
const format = (value: number) =>
  Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, useGrouping: false }).format(value) : '无有效值';
const INTEGER_COLUMNS = new Set([
  'fleet pts',
  'hitpoints',
  'armor rating',
  'max flux',
  'flux dissipation',
  'ordnance points',
  'fighter bays',
  'max speed',
  'acceleration',
  'deceleration',
  'base value',
]);

export function projectShipPanel(
  snapshot: JointEditSnapshot,
  values: Record<string, JointValue>,
  projection: JointEditSnapshot | null = snapshot,
): ShipImmersivePanel {
  const sources = shipSourceRecords(snapshot);
  const csv = jointObject(values[sources.csv.key]);
  const spec = jointObject(values[sources.spec.key]);
  const desc = jointObject(values[sources.description.key]);
  const columns = getCsvColumnSchemas('ships');
  function csvField(key: string, label?: string): ImmersiveField {
    const column = columns.find((column) => column.key === key);
    return {
      id: 'csv/' + key,
      recordKey: sources.csv.key,
      schema: {
        key,
        label: label ?? column?.label ?? key,
        type: INTEGER_COLUMNS.has(key)
          ? 'integer'
          : column?.control === 'number'
            ? 'float'
            : column?.control === 'enum'
              ? 'enum'
              : 'string',
        options: column?.options,
        source: column?.source,
      },
    };
  }
  function numeric(key: string, label: string, fallback: number, unit = '', tone: ImmersiveStat['tone'] = 'highlight'): ImmersiveStat {
    const raw = schemaStringValue(csv[key]);
    const value = number(key, fallback);
    const field = csvField(key, label);
    field.schema.type = INTEGER_COLUMNS.has(key) ? 'integer' : 'float';
    return {
      id: key,
      label,
      display: Number.isFinite(value) ? format(value) + unit : '无有效值',
      fields: [field],
      tone,
      diagnostic: raw.trim() ? (Number.isFinite(value) ? undefined : `${key} 不是有效数字`) : `${key} 缺失，显示原版默认值 ${fallback}`,
    };
  }
  function number(key: string, fallback: number): number {
    const raw = schemaStringValue(csv[key]);
    if (!raw.trim()) return fallback;
    const parsed = parseInputNumber(raw, INTEGER_COLUMNS.has(key));
    return typeof parsed === 'number' ? parsed : NaN;
  }
  const heading: ImmersiveStat[] = [
    { id: 'name', label: '舰船名称', display: schemaStringValue(csv.name) || '未命名舰船', fields: [csvField('name')] },
    { id: 'designation', label: '定位', display: schemaStringValue(csv.designation) || '未提供定位', fields: [csvField('designation')] },
    {
      id: 'tech/manufacturer',
      label: '设计类型',
      display: schemaStringValue(csv['tech/manufacturer']) || 'Common',
      fields: [csvField('tech/manufacturer')],
    },
  ];
  const description: ImmersiveStat = {
    id: 'description',
    label: '舰船描述',
    display: schemaStringValue(desc.text1) || '描述未提供',
    tone: 'normal',
    fields: [1, 2, 3, 4, 5].map((index) => ({
      id: 'description/text' + index,
      recordKey: sources.description.key,
      schema: { key: 'text' + index, label: index === 1 ? '主描述 text1' : `描述段落 text${index}`, type: 'text' },
    })),
  };
  const recovery = numeric('supplies/rec', '恢复成本（补给）', 0);
  const peak = numeric('peak CR sec', '峰值作战时间', 9999999, ' 秒');
  if (number('CR loss/sec', 0) <= 0) peak.display = '无限';
  peak.fields.push(csvField('CR loss/sec', '每秒战备损失'));
  peak.formula = '原版在每秒战备损失小于等于零时显示无限峰值作战时间。';
  const crew: ImmersiveStat = {
    id: 'crew',
    label: '最少／最多船员',
    display: `${format(number('min crew', 1))} / ${format(number('max crew', 1))}`,
    fields: [csvField('min crew'), csvField('max crew')],
    tone: 'crew',
  };
  const hull: ImmersiveStat = {
    id: 'hullSize',
    label: '舰体尺寸',
    display: HULL_SIZE_LABELS[schemaStringValue(spec.hullSize)] ?? (schemaStringValue(spec.hullSize) || '未提供'),
    fields: [
      {
        id: 'spec/hullSize',
        recordKey: sources.spec.key,
        schema: { key: 'hullSize', label: '舰体尺寸', type: 'enum', required: true, options: Object.keys(HULL_SIZE_LABELS) },
      },
    ],
  };
  const hullOrdinal = { FIGHTER: 1, FRIGATE: 2, DESTROYER: 3, CRUISER: 4, CAPITAL_SHIP: 5 }[schemaStringValue(spec.hullSize)] ?? 2;
  const sensorKey =
    { DESTROYER: 'baseSensorDestroyer', CRUISER: 'baseSensorCruiser', CAPITAL_SHIP: 'baseSensorCapital' }[
      schemaStringValue(spec.hullSize)
    ] ?? 'baseSensorFrigate';
  const referenceSettings = (projection ?? snapshot).referenceSettings;
  const sensorValue = referenceSettings.values[sensorKey];
  const sensor = (id: string, label: string): ImmersiveStat => ({
    id,
    label,
    display: typeof sensorValue === 'number' ? format(sensorValue) : '来源未提供',
    fields: hull.fields,
    formula: `${sensorKey} · ${referenceSettings.versions.map((version) => version.path).join(' → ')}`,
    diagnostic: typeof sensorValue === 'number' ? undefined : '当前舰体尺寸的传感器配置来源未提供',
  });
  const logistics = [
    [
      numeric('CR to deploy', '每次部署战备消耗', 25, '%', 'normal'),
      numeric(
        Object.hasOwn(csv, 'cr %/day') || !Object.hasOwn(csv, 'repair %/day') ? 'cr %/day' : 'repair %/day',
        '每日战备恢复',
        30 - hullOrdinal * 5,
        '%',
        'normal',
      ),
      recovery,
      { ...recovery, id: 'deployment-points', label: '部署点数', formula: '基础部署点数使用 supplies/rec，插件效果按零效果计算。' },
      peak,
      crew,
      hull,
      numeric('ordnance points', '装配点', 0),
    ],
    [
      numeric('supplies/mo', '月维持补给', 0),
      numeric('cargo', '货仓容量', 0),
      numeric('max crew', '最大船员数', 1, '', 'crew'),
      numeric('min crew', '最低船员需求', 1, '', 'crew'),
      numeric('fuel', '燃料容量', 0),
      numeric('max burn', '最大航速', 4),
      numeric('fuel/ly', '每光年燃料消耗', 0),
      sensor('sensor-profile', '传感器轮廓'),
      sensor('sensor-strength', '传感器强度'),
    ],
  ];
  const shieldType = schemaStringValue(csv['shield type']) || 'NONE';
  const defense: ImmersiveStat = {
    id: 'shield type',
    label: '防御',
    display: { NONE: '无', FRONT: '前置护盾', OMNI: '全向护盾', PHASE: '相位斗篷' }[shieldType] ?? shieldType,
    fields: [csvField('shield type'), csvField('defense id')],
  };
  const defenseStats: ImmersiveStat[] =
    shieldType === 'PHASE'
      ? [
          {
            id: 'phase cost',
            label: '相位启动消耗',
            display: format(number('phase cost', 0) * number('max flux', 10)),
            fields: [csvField('phase cost'), csvField('max flux')],
            formula: '相位启动消耗 = phase cost × max flux',
          },
          {
            id: 'phase upkeep',
            label: '相位每秒维持',
            display: format(number('phase upkeep', 0) * number('max flux', 10)),
            fields: [csvField('phase upkeep'), csvField('max flux')],
            formula: '相位每秒维持 = phase upkeep × max flux',
          },
        ]
      : shieldType === 'NONE'
        ? []
        : [
            numeric('shield arc', '护盾角度', 30, '°'),
            {
              id: 'shield upkeep',
              label: '护盾每秒维持',
              display: format(number('shield upkeep', 0) * number('flux dissipation', 1)),
              fields: [csvField('shield upkeep'), csvField('flux dissipation')],
              formula: '护盾每秒维持 = shield upkeep × flux dissipation',
            },
            numeric('shield efficiency', '护盾幅能／伤害', 1),
          ];
  const armor = numeric('armor rating', '装甲等级', 0);
  armor.display = format(Math.max(number('armor rating', 0), 1));
  armor.formula = '原版装甲等级最低为 1，编辑来源 armor rating。';
  const combat = [
    numeric('hitpoints', '结构', 1),
    armor,
    defense,
    ...defenseStats,
    numeric('max flux', '幅能容量', 10),
    numeric('flux dissipation', '幅能耗散', 1),
    numeric('max speed', '最高战斗速度', 10),
  ];
  const references = projection?.records ?? [];
  const systemRecord = references.find((record) => record.key === projection?.bindings.system);
  const systemId = systemRecord?.target.kind === 'spec' ? systemRecord.target.target.id : schemaStringValue(csv['system id']);
  const systemCsv = references.find(
    (record) => record.target.kind === 'csv' && record.target.table === 'shipSystems' && record.target.identity.id === systemId,
  );
  const systemDescriptionId = schemaStringValue(jointObject(systemRecord?.value).descriptionId) || systemId;
  const systemDesc = references.find(
    (record) =>
      record.target.kind === 'csv' &&
      record.target.table === 'descriptions' &&
      record.target.identity.id === systemDescriptionId &&
      record.target.identity.type === 'SHIP_SYSTEM',
  );
  const system: ImmersiveStat = {
    id: 'system',
    label: '战术系统',
    display: schemaStringValue(jointObject(systemCsv?.value).name) || systemId || '无',
    fields: [csvField('system id')],
    diagnostic: systemId && !systemCsv?.source ? `系统 ${systemId} 的来源未提供` : undefined,
  };
  const systemText = jointObject(systemDesc?.value);
  const mountCounts = new Map<string, number>();
  const slots = Array.isArray(spec.weaponSlots) ? spec.weaponSlots : [];
  for (const slot of slots) {
    const data = jointObject({ state: 'present', value: slot });
    const type = schemaStringValue(data.type);
    if (!MOUNT_LABELS[type]) continue;
    const key = `${SIZE_LABELS[schemaStringValue(data.size)] ?? schemaStringValue(data.size)}${MOUNT_LABELS[type]}`;
    mountCounts.set(key, (mountCounts.get(key) ?? 0) + 1);
  }
  const weapons = spec.builtInWeapons;
  const weaponCounts = new Map<string, number>();
  if (weapons && typeof weapons === 'object' && !Array.isArray(weapons))
    for (const id of Object.values(weapons)) {
      const value = schemaStringValue(id);
      weaponCounts.set(value, (weaponCounts.get(value) ?? 0) + 1);
    }
  const weaponNames = new Map(
    references.flatMap((record) =>
      record.target.kind === 'csv' && record.target.table === 'weapons'
        ? ([[record.target.identity.id, schemaStringValue(jointObject(record.value).name)]] as Array<[string, string]>)
        : [],
    ),
  );
  const mods = Array.isArray(spec.builtInMods) ? spec.builtInMods : [];
  const hullmods = mods.map((value) => {
    const id = schemaStringValue(value);
    const record = references.find(
      (record) => record.target.kind === 'csv' && record.target.table === 'hullmods' && record.target.identity.id === id,
    );
    const data = jointObject(record?.value);
    const scripted = schemaStringValue(data.desc).includes('<tooltip');
    return {
      id,
      name: schemaStringValue(data.name) || id,
      description: scripted ? `${schemaStringValue(data.short)}（详细说明由游戏脚本生成）` : schemaStringValue(data.desc) || '说明未提供',
    };
  });
  const allStats = [...heading, description, ...logistics.flat(), ...combat, system];
  return {
    heading,
    description,
    logistics,
    combat,
    system,
    systemDescription: schemaStringValue(systemText.text3) || schemaStringValue(systemText.text1) || '系统说明未提供',
    mounts: [...mountCounts].map(([name, count]) => `${count}× ${name}`).join('，') || '无',
    armaments: [...weaponCounts].map(([id, count]) => `${count}× ${weaponNames.get(id) || id}`).join('，') || '无',
    hullmods,
    sprite: sources.spec.resourceRefs.sprite ?? null,
    allStats,
  };
}
