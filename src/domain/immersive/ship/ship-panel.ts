import type { JointEditSnapshot, JointValue, ResourceRef, JointHullProjection, DeepReadonly } from '@/shared/types';
import type { ImmersiveField, ImmersiveStat } from '../fields';
import { jointObject } from '@/domain/joint-edit';
import { hullDataIndex, hullFieldInputs, hullFieldValue } from '../hull-fields';
import { immersiveSourceRecords } from '../source-records';
import { getCsvColumnSchemas } from '@/domain/schema/csv-schema-registry';
import { schemaStringValue } from '@/domain/schema/schema-values';
import { parseInputNumber } from '@/shared/lib/input-number';
import { designTypeColor } from '../design-type';
import type { TextRun } from '@/domain/fonts/font.types';
export interface ImmersiveShipContext {
  hull: JointHullProjection;
  name: string;
  capacity: number;
  dissipation: number;
  shieldFlux: number;
  opUsed: number;
  opTotal: number;
  weapons: DeepReadonly<Array<{ id: string; name: string; builtin: boolean }>>;
  wings: DeepReadonly<Array<{ id: string; name: string; index: number; builtin: boolean }>>;
  mods: DeepReadonly<Array<{ name: string; category: 'builtin' | 'normal' | 'permanent' | 's'; strengthened: boolean }>>;
  diagnostics: readonly string[];
}

export interface ShipImmersivePanel {
  kind: 'ship';
  heading: ImmersiveStat[];
  description: ImmersiveStat;
  logistics: ImmersiveStat[][];
  combat: ImmersiveStat[];
  system: ImmersiveStat;
  systemDescription: string;
  mounts: string;
  mountRuns: TextRun[];
  armaments: string;
  armamentRuns: TextRun[];
  hullmods: string;
  sprite: ResourceRef | null;
  hullSize: string;
  allStats: ImmersiveStat[];
  equipment: Array<{ label: string; text: string; runs?: TextRun[] }>;
  notes: string[];
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
  variant?: ImmersiveShipContext,
): ShipImmersivePanel {
  const graph = projection ?? snapshot;
  const find = (key: string | undefined) => graph.records.find((record) => record.key === key);
  const effectiveHull = variant?.hull ?? graph.hull;
  const sources = effectiveHull
    ? {
        spec: find(effectiveHull.hullKey)!,
        csv: find(effectiveHull.displayBindings.csv)!,
        description: find(effectiveHull.displayBindings.description),
      }
    : immersiveSourceRecords(snapshot);
  const indexed = hullDataIndex(graph.records, values);
  const data = (key: string | undefined) => (key ? indexed.get(key)! : {});
  const csv = data(sources.csv.key);
  const spec = data(sources.spec.key);
  const desc = data(sources.description?.key);
  const value = (key: string) => {
    const binding = effectiveHull?.fields[key];
    return binding ? hullFieldValue(binding, indexed) : csv[key];
  };
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
            : column?.control === 'enum' || column?.source
              ? 'enum'
              : 'string',
        options: column?.options,
        source: column?.source,
      },
    };
  }
  function csvFields(key: string, label?: string): ImmersiveField[] {
    const base = csvField(key, label),
      inputs = effectiveHull?.fields[key];
    return inputs ? hullFieldInputs(inputs, key, base.schema.label!) : [base];
  }
  function numeric(key: string, label: string, fallback: number, unit = '', tone: ImmersiveStat['tone'] = 'highlight'): ImmersiveStat {
    const raw = schemaStringValue(value(key));
    const amount = number(key, fallback);
    const fields = csvFields(key, label);
    fields[0]!.schema.type = INTEGER_COLUMNS.has(key) ? 'integer' : 'float';
    return {
      id: key,
      label,
      display: Number.isFinite(amount) ? format(amount) + unit : '无有效值',
      fields,
      tone,
      diagnostic: raw.trim() ? (Number.isFinite(amount) ? undefined : `${key} 不是有效数字`) : `${key} 缺失，显示原版默认值 ${fallback}`,
    };
  }
  function number(key: string, fallback: number): number {
    if (variant && key === 'max flux') return variant.capacity;
    if (variant && key === 'flux dissipation') return variant.dissipation;
    const raw = schemaStringValue(value(key));
    if (!raw.trim()) return fallback;
    const parsed = parseInputNumber(raw, INTEGER_COLUMNS.has(key));
    return typeof parsed === 'number' ? parsed : NaN;
  }
  const heading: ImmersiveStat[] = [
    {
      id: 'name',
      label: '舰船名称',
      display: variant?.name || schemaStringValue(value('name')) || '未命名舰船',
      fields: csvFields('name'),
    },
    {
      id: 'designation',
      label: '定位',
      display: schemaStringValue(value('designation')) || '未提供定位',
      fields: csvFields('designation'),
    },
    {
      id: 'tech/manufacturer',
      label: '设计类型',
      display: schemaStringValue(value('tech/manufacturer')) || 'Common',
      fields: csvFields('tech/manufacturer'),
    },
  ];
  const description: ImmersiveStat = {
    id: 'description',
    label: '舰船描述',
    display: schemaStringValue(desc.text1) || '描述未提供',
    tone: 'normal',
    fields: sources.description
      ? [1, 2, 3, 4, 5].map((index) => ({
          id: 'description/text' + index,
          recordKey: sources.description!.key,
          schema: { key: 'text' + index, label: index === 1 ? '主描述 text1' : `描述段落 text${index}`, type: 'text' },
        }))
      : [],
  };
  let prefix = '';
  for (const [index, key] of (effectiveHull?.skinKeys ?? []).entries()) {
    const skin = data(key);
    if (skin.descriptionPrefix !== undefined) prefix = schemaStringValue(skin.descriptionPrefix);
    description.fields.push(
      {
        id: 'skin/' + index + '/descriptionId',
        recordKey: key,
        inheritOnEmpty: true,
        handoff: true,
        schema: { key: 'descriptionId', type: 'enum', source: 'csv:descriptions.id', label: '皮肤描述引用（空白采用皮肤 ID）' },
      },
      {
        id: 'skin/' + index + '/descriptionPrefix',
        recordKey: key,
        inheritOnEmpty: true,
        schema: { key: 'descriptionPrefix', type: 'text', label: '皮肤描述前缀（空白继承）' },
      },
    );
  }
  if (prefix) description.display = prefix + '\n\n' + description.display;
  const recovery = numeric('supplies/rec', '战备恢复成本 (补给)', 0);
  const peak = numeric('peak CR sec', '峰值时间', 9999999, ' 秒');
  if (number('CR loss/sec', 0) <= 0) peak.display = '无限';
  peak.fields.push(...csvFields('CR loss/sec', '每秒战备值衰减'));
  peak.formula = '原版在每秒战备值衰减小于等于零时显示无限峰值时间。';
  const crew: ImmersiveStat = {
    id: 'crew',
    label: '船员配额',
    display: `${format(number('min crew', 1))} / ${format(number('max crew', 1))}`,
    fields: [...csvFields('min crew'), ...csvFields('max crew')],
    tone: 'crew',
  };
  const hull: ImmersiveStat = {
    id: 'hullSize',
    label: '船体级别',
    display: HULL_SIZE_LABELS[schemaStringValue(spec.hullSize)] ?? (schemaStringValue(spec.hullSize) || '未提供'),
    fields: [
      {
        id: 'spec/hullSize',
        recordKey: sources.spec.key,
        schema: { key: 'hullSize', label: '船体级别', type: 'enum', required: true, options: Object.keys(HULL_SIZE_LABELS) },
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
    diagnostic: typeof sensorValue === 'number' ? undefined : '当前船体级别的传感器配置来源未提供',
  });
  const logistics = [
    [
      numeric('CR to deploy', '作战后消耗的战备值 (CR)', 25, '%', 'normal'),
      numeric(
        Object.hasOwn(csv, 'cr %/day') || !Object.hasOwn(csv, 'repair %/day') ? 'cr %/day' : 'repair %/day',
        '战备恢复速率 (每天)',
        30 - hullOrdinal * 5,
        '%',
        'normal',
      ),
      recovery,
      { ...recovery, id: 'deployment-points', label: '部署点数', formula: '基础部署点数使用 supplies/rec，插件效果按零效果计算。' },
      peak,
      crew,
      hull,
      numeric('ordnance points', '装配点数', 0),
      numeric('fleet pts', '舰队点数', 0),
      numeric('base value', '基础价值', 0),
      numeric('fighter bays', '战机甲板数量', 0),
    ],
    [
      numeric('supplies/mo', '维护消耗 (补给/月)', 0),
      numeric('cargo', '载货量', 0),
      numeric('max crew', '最大载员', 1, '', 'crew'),
      numeric('min crew', '必要船员', 1, '', 'crew'),
      numeric('fuel', '燃料容量', 0, '', 'fuel'),
      numeric('max burn', '最大宇宙航速', 4),
      numeric('fuel/ly', '燃料消耗 (光年)', 0),
      sensor('sensor-profile', '传感器截面'),
      sensor('sensor-strength', '探测范围'),
    ],
  ];
  const shieldType = schemaStringValue(value('shield type')) || 'NONE';
  const defense: ImmersiveStat = {
    id: 'shield type',
    label: '防御方式',
    display: { NONE: '无', FRONT: '前盾', OMNI: '全盾', PHASE: '相位线圈' }[shieldType] ?? shieldType,
    fields: [...csvFields('shield type'), ...csvFields('defense id')],
  };
  const defenseStats: ImmersiveStat[] =
    shieldType === 'PHASE'
      ? [
          {
            id: 'phase cost',
            label: '相位线圈激活',
            display: format(number('phase cost', 0) * number('max flux', 10)),
            fields: [...csvFields('phase cost'), ...csvFields('max flux')],
            formula: '相位线圈激活 = phase cost × max flux',
          },
          {
            id: 'phase upkeep',
            label: '相位线圈维持 (幅能/秒)',
            display: format(number('phase upkeep', 0) * number('max flux', 10)),
            fields: [...csvFields('phase upkeep'), ...csvFields('max flux')],
            formula: '相位线圈维持 (幅能/秒) = phase upkeep × max flux',
          },
        ]
      : shieldType === 'NONE'
        ? []
        : [
            numeric('shield arc', '护盾角度', 30, '°'),
            {
              id: 'shield upkeep',
              label: '护盾维持 (幅能/秒)',
              display: format(variant ? variant.shieldFlux : number('shield upkeep', 0) * number('flux dissipation', 1)),
              fields: [...csvFields('shield upkeep'), ...csvFields('flux dissipation')],
              formula: '护盾维持 (幅能/秒) = shield upkeep × flux dissipation',
            },
            numeric('shield efficiency', '护盾效率 (幅能/伤害)', 1),
          ];
  const armor = numeric('armor rating', '装甲值', 0);
  armor.display = format(Math.max(number('armor rating', 0), 1));
  armor.formula = '原版装甲值最低为 1，编辑来源 armor rating。';
  const combat = [
    numeric('hitpoints', '船体结构值', 1),
    armor,
    defense,
    ...defenseStats,
    numeric('max flux', '幅能容量', 10),
    numeric('flux dissipation', '幅能耗散', 1),
    numeric('max speed', '最高航速', 10),
  ];
  const references = projection?.records ?? [];
  const systemRecord = references.find((record) => record.key === (variant?.hull.displayBindings.system ?? projection?.bindings.system));
  const systemId = systemRecord?.target.kind === 'spec' ? systemRecord.target.target.id : schemaStringValue(value('system id'));
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
    fields: csvFields('system id'),
    diagnostic: systemId && !systemCsv?.source ? `系统 ${systemId} 的来源未提供` : undefined,
  };
  const systemText = jointObject(systemDesc?.value);
  const mountCounts = new Map<string, number>();
  const slots = effectiveHull?.slots ?? (Array.isArray(spec.weaponSlots) ? spec.weaponSlots : []);
  for (const slot of slots) {
    const data = jointObject({ state: 'present', value: slot });
    const type = schemaStringValue(data.type);
    if (!MOUNT_LABELS[type]) continue;
    const key = `${SIZE_LABELS[schemaStringValue(data.size)] ?? schemaStringValue(data.size)}${MOUNT_LABELS[type]}`;
    mountCounts.set(key, (mountCounts.get(key) ?? 0) + 1);
  }
  const weapons = effectiveHull?.builtInWeapons ?? spec.builtInWeapons;
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
  const mods = effectiveHull?.builtInMods ?? (Array.isArray(spec.builtInMods) ? spec.builtInMods : []);
  const hullmods = mods.map((value) => {
    const id = schemaStringValue(value);
    const record = references.find(
      (record) => record.target.kind === 'csv' && record.target.table === 'hullmods' && record.target.identity.id === id,
    );
    const data = jointObject(record?.value);
    return schemaStringValue(data.name) || id;
  });
  const allStats = [...heading, description, ...logistics.flat(), ...combat, system];
  for (const entry of heading.slice(0, 2)) entry.font = 'ship-title';
  heading[2]!.inline = true;
  heading[2]!.displayRuns = [{ text: heading[2]!.display, color: designTypeColor(projection ?? snapshot, heading[2]!.display) }];
  peak.gapBefore = true;
  hull.gapBefore = true;
  const panel: ShipImmersivePanel = {
    kind: 'ship',
    heading,
    description,
    logistics,
    combat,
    system,
    systemDescription: schemaStringValue(systemText.text3) || schemaStringValue(systemText.text1) || '系统说明未提供',
    mounts: [...mountCounts].map(([name, count]) => `${count}× ${name}`).join('，') || '无',
    mountRuns: [...mountCounts].flatMap(([name, count], index) => [
      ...(index ? [{ text: '，', color: '#dcdcdc' }] : []),
      { text: `${count}× `, color: '#ffd200' },
      { text: name, color: '#dcdcdc' },
    ]),
    armaments: [...weaponCounts].map(([id, count]) => `${count}× ${weaponNames.get(id) || id}`).join('，') || '无',
    armamentRuns: [...weaponCounts].flatMap(([id, count], index) => [
      ...(index ? [{ text: '，', color: '#dcdcdc' }] : []),
      { text: `${count}× `, color: '#ffd200' },
      { text: weaponNames.get(id) || id, color: '#dcdcdc' },
    ]),
    hullmods: hullmods.join('，') || '无',
    sprite: effectiveHull ? effectiveHull.sprite : (sources.spec.resourceRefs.sprite ?? null),
    hullSize: schemaStringValue(spec.hullSize),
    allStats,
    equipment: [],
    notes: variant ? ['基础配置口径 · 插件效果按零效果计算', ...variant.diagnostics] : [],
  };
  panel.equipment = [
    { label: '安装槽位', text: panel.mounts, runs: panel.mountRuns },
    { label: '军备详情', text: panel.armaments, runs: panel.armamentRuns },
    { label: '船体插件', text: panel.hullmods },
  ];
  if (variant) {
    const op = logistics[0]!.find((stat) => stat.id === 'ordnance points')!;
    op.label = '已用/总装配点数';
    op.display = `${format(variant.opUsed)} / ${format(variant.opTotal)}`;
    for (const stat of combat) {
      if (stat.id === 'max flux') stat.formula = '有效船体容量 + 幅能寄存器 × fluxPerCapacitor';
      if (stat.id === 'flux dissipation') stat.formula = '有效船体耗散 + 耗散通道 × dissipationPerVent';
    }
    const weaponCounts = new Map<string, number>();
    for (const weapon of variant.weapons.filter((weapon) => weapon.id)) {
      const name = weapon.name + (weapon.builtin ? '（内置）' : '');
      weaponCounts.set(name, (weaponCounts.get(name) ?? 0) + 1);
    }
    panel.equipment = [
      panel.equipment[0]!,
      { label: '军备详情', text: [...weaponCounts].map(([name, count]) => `${count}× ${name}`).join('，') || '无' },
      {
        label: '战机联队',
        text:
          variant.wings
            .filter((wing) => wing.id)
            .map((wing) => `${wing.name} (战机甲板 ${wing.index + 1}${wing.builtin ? '，内置' : ''})`)
            .join('，') || '无',
      },
      {
        label: '船体插件',
        text:
          variant.mods
            .map(
              (mod) =>
                `${mod.name} (${{ builtin: '内置', normal: '普通', permanent: '永久', s: 'S 插件' }[mod.category]}${mod.strengthened ? '，内置 S 强化' : ''})`,
            )
            .join('，') || '无',
      },
    ];
  }
  return panel;
}

export function shipProjectionInputs(snapshot: JointEditSnapshot, values: Record<string, JointValue>): import('@/shared/types').RowData {
  const csv = jointObject(values[immersiveSourceRecords(snapshot).csv.key]);
  return { systemId: csv['system id'] ?? null, shieldType: csv['shield type'] ?? null, defenseId: csv['defense id'] ?? null };
}
