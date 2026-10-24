import type { JointEditSnapshot, JointValue, ResourceRef } from '@/shared/types';
import type { ImmersiveField, ImmersiveStat } from '../fields';
import { jointObject } from '@/domain/joint-edit';
import { schemaStringValue } from '@/domain/schema/schema-values';
import { getCsvColumnSchemas } from '@/domain/schema/csv-schema-registry';
import { parseInputNumber } from '@/shared/lib/input-number';
import { designTypeColor } from '../design-type';
import { highlightedTextParts } from '../highlighted-text';
import type { TextRun } from '@/domain/fonts/font.types';
import { immersiveSnapshotScene, type ImmersiveHullProjection } from '../hull-scene';

export interface WingPanel {
  kind: 'wing';
  heading: ImmersiveStat[];
  description: ImmersiveStat;
  technical: ImmersiveStat[];
  system: ImmersiveStat;
  systemRuns: TextRun[];
  armaments: string;
  armamentRuns: TextRun[];
  sources: ImmersiveStat[];
  sprite: ResourceRef | null;
  preview: ImmersiveHullProjection | null;
  count: number;
  formation: string;
  allStats: ImmersiveStat[];
  defaultDescription: ImmersiveField | null;
}
export const WING_ROLE_LABELS: Record<string, string> = {
  FIGHTER: '战斗机',
  INTERCEPTOR: '截击机',
  BOMBER: '轰炸机',
  ASSAULT: '突击机',
  SUPPORT: '支援机',
};

export function projectWingPanel(
  snapshot: JointEditSnapshot,
  values: Record<string, JointValue>,
  projection: JointEditSnapshot | null = snapshot,
): WingPanel {
  const graph = projection ?? snapshot,
    hull = graph.hull;
  const data = (key: string | undefined) =>
    jointObject(key ? (values[key] ?? graph.records.find((record) => record.key === key)?.value) : undefined);
  const wingKey = snapshot.bindings.csv!,
    wing = data(wingKey);
  const columns = getCsvColumnSchemas('wings');
  const field = (recordKey: string, key: string, label: string, type: ImmersiveField['schema']['type'] = 'string'): ImmersiveField => ({
    id:
      (Object.entries(snapshot.bindings).find(([, binding]) => binding === recordKey)?.[0] ??
        'skin/' + snapshot.hull!.skinKeys.indexOf(recordKey)) +
      '/' +
      key,
    recordKey,
    schema: { key, label, type },
  });
  const wf = (key: string, label?: string): ImmersiveField => {
    const column = columns.find((column) => column.key === key)!;
    const result = field(
      wingKey,
      key,
      label ?? column.label ?? key,
      column.control === 'number' ? 'float' : column.control === 'enum' || column.source ? 'enum' : 'string',
    );
    result.schema.options = column.options;
    result.schema.source = column.source;
    return result;
  };
  const hf = (key: string, label: string, type: ImmersiveField['schema']['type'] = 'string'): ImmersiveField[] => {
    const binding = hull?.fields[key];
    if (!binding) return [];
    const result = field(binding.recordKey, binding.path, label, type);
    const source = getCsvColumnSchemas('ships').find((column) => column.key === key)?.source;
    if (source) result.schema = { ...result.schema, type: 'enum', source };
    return [result];
  };
  const hv = (key: string) => {
    const binding = hull?.fields[key];
    return binding ? data(binding.recordKey)[binding.path] : undefined;
  };
  const stat = (id: string, label: string, display: string, fields: ImmersiveField[]): ImmersiveStat => ({ id, label, display, fields });
  const number = (value: unknown, fallback: number) => {
    if (value !== undefined && typeof value !== 'string' && typeof value !== 'number') return NaN;
    const raw = schemaStringValue(value).trim();
    if (!raw) return fallback;
    const parsed = parseInputNumber(raw, false);
    return typeof parsed === 'number' ? parsed : NaN;
  };
  const displayNumber = (value: number) => (Number.isFinite(value) ? String(Math.trunc(value)) : '来源数值无效');
  const wn = (key: string, label: string, fallback: number) => ({
    ...stat(key, label, displayNumber(number(wing[key], fallback)), [wf(key, label)]),
    diagnostic: wing[key] === undefined ? `${key} 缺失，显示原版默认值 ${fallback}` : undefined,
  });
  const hn = (key: string, label: string, fallback: number) => ({
    ...stat(
      key,
      label,
      hull ? displayNumber(number(hv(key), fallback)) : '来源未提供',
      hf(key, label, key === 'min crew' ? 'float' : 'integer'),
    ),
    diagnostic: hull && hv(key) === undefined ? `${key} 缺失，显示原版默认值 ${fallback}` : undefined,
  });
  const variantKey = snapshot.bindings.variant,
    variant = data(variantKey);
  const hullNameLabel = hull?.fields.name?.path === 'hullName' ? '船体名称' : '舰船名称';
  const name = stat(
    'name',
    '战机联队名称',
    [schemaStringValue(hv('name')) || `${hullNameLabel}未提供`, schemaStringValue(variant.displayName)].filter(Boolean).join(' '),
    [...hf('name', hullNameLabel), ...(variantKey ? [field(variantKey, 'displayName', '装配显示名称')] : [])],
  );
  name.font = 'heading';
  const manufacturer = stat(
    'manufacturer',
    '设计类型',
    schemaStringValue(hv('tech/manufacturer')) || 'Common',
    hf('tech/manufacturer', '设计类型'),
  );
  manufacturer.inline = true;
  manufacturer.displayRuns = [{ text: manufacturer.display, color: designTypeColor(graph, manufacturer.display) }];
  const descriptionKey = snapshot.bindings.description,
    descriptionData = data(descriptionKey);
  const description = stat(
    'description',
    '战机描述',
    schemaStringValue(descriptionData.text1) || '描述未提供',
    descriptionKey ? [1, 2, 3, 4, 5].map((index) => field(descriptionKey, 'text' + index, '描述 text' + index, 'text')) : [],
  );
  description.tone = 'normal';
  const role = schemaStringValue(wing.role) || 'FIGHTER';
  const roleField = wf('role');
  roleField.optionLabels = WING_ROLE_LABELS;
  const technical = [
    stat('role', '战术应用', schemaStringValue(wing['role desc']) || WING_ROLE_LABELS[role] || role, [roleField, wf('role desc')]),
  ];
  const swarm = schemaStringValue(wing.tags)
    .split(',')
    .some((tag) => tag.trim() === 'swarm_fighter');
  if (!swarm) {
    technical.push(
      wn('op cost', '装配点数', 0),
      hn('min crew', '必要船员 (每架)', 1),
      wn('range', role === 'SUPPORT' ? '最大支援范围' : '最大交战范围', 0),
    );
    technical.push(wn('num', '联队战机数量', 1), wn('refit', '战机更换时间 (秒)', 10));
    technical.find((stat) => stat.id === 'num')!.gapBefore = true;
  }
  const structure = hn('hitpoints', '船体结构值', 1);
  structure.gapBefore = true;
  technical.push(structure);
  const armor = number(hv('armor rating'), 0);
  if (!hull || armor > 1) technical.push(hn('armor rating', '装甲值', 0));
  const shield = schemaStringValue(hv('shield type')) || 'NONE';
  if (shield !== 'NONE') {
    const phaseId = schemaStringValue(hv('defense id')) || 'phasecloak';
    const phaseCsv = graph.records.find(
      (record) => record.target.kind === 'csv' && record.target.table === 'shipSystems' && record.target.identity.id === phaseId,
    );
    const phaseName =
      phaseId === 'phasecloak' && phaseCsv?.source?.source !== 'mod'
        ? '相位线圈'
        : schemaStringValue(jointObject(phaseCsv?.value).name) || phaseId;
    const defense =
      shield === 'PHASE'
        ? stat('defense', phaseId === 'phasecloak' ? '防御方式' : '特殊系统', phaseName, [
            ...hf('shield type', '防御类型'),
            ...hf('defense id', '防御系统', 'enum'),
          ])
        : stat('defense', shield === 'FRONT' ? '前盾 (幅能容量)' : '全盾 (幅能容量)', displayNumber(number(hv('max flux'), 10)), [
            ...hf('shield type', '防御类型'),
            ...hf('max flux', '幅能容量', 'integer'),
          ]);
    const selector = defense.fields[0];
    if (selector) {
      selector.schema.type = 'enum';
      selector.schema.options = ['NONE', 'FRONT', 'OMNI', 'PHASE'];
      selector.optionLabels = { NONE: '无', FRONT: '前盾', OMNI: '全盾', PHASE: '相位线圈' };
    }
    technical.push(defense);
    for (const entry of defense.fields) if (entry.schema.key === 'defense id') entry.schema.source = 'csv:shipSystems.id';
  }
  technical.push(hn('max speed', '最高航速', 10));
  const systemKey = graph.bindings.system;
  const systemRecord = graph.records.find((record) => record.key === systemKey);
  const systemId = schemaStringValue(hv('system id'));
  const systemCsv = graph.records.find(
    (record) => record.target.kind === 'csv' && record.target.table === 'shipSystems' && record.target.identity.id === systemId,
  );
  const systemDescriptionId = schemaStringValue(jointObject(systemRecord?.value).descriptionId) || systemId;
  const systemDescription = graph.records.find(
    (record) =>
      record.target.kind === 'csv' &&
      record.target.table === 'descriptions' &&
      record.target.identity.id === systemDescriptionId &&
      record.target.identity.type === 'SHIP_SYSTEM',
  );
  const systemData = jointObject(systemDescription?.value);
  const system = stat(
    'system',
    '战术系统',
    schemaStringValue(jointObject(systemCsv?.value).name) || systemId || '无',
    hf('system id', '战术系统', 'enum'),
  );
  for (const entry of system.fields) entry.schema.source = 'csv:shipSystems.id';
  const counts = new Map<string, number>();
  for (const id of Object.values(hull?.weapons ?? {})) counts.set(id, (counts.get(id) ?? 0) + 1);
  const weaponNames = new Map(
    graph.records.flatMap((record) =>
      record.target.kind === 'csv' && record.target.table === 'weapons'
        ? [[record.target.identity.id!, schemaStringValue(jointObject(record.value).name)] as const]
        : [],
    ),
  );
  const armamentRuns = [...counts].flatMap(([id, count], index) => [
    ...(index ? [{ text: '，', color: '#dcdcdc' }] : []),
    { text: count + '× ', color: '#ffd200' },
    { text: weaponNames.get(id) || id, color: '#dcdcdc' },
  ]);
  const variantReference = wf('variant', '装配引用');
  variantReference.handoff = true;
  variantReference.schema.required = true;
  const sources = [stat('variant-reference', '装配', schemaStringValue(wing.variant) || '引用未提供', [variantReference])];
  if (variantKey) {
    const hullReference = field(variantKey, 'hullId', '船体/Skin引用', 'enum');
    hullReference.schema.source = 'hull:ids';
    hullReference.schema.required = true;
    hullReference.handoff = true;
    sources.push(stat('hull-reference', '船体/Skin', schemaStringValue(variant.hullId) || '引用未提供', [hullReference]));
  }
  const selectedHull = snapshot.records.find((record) => record.key === snapshot.bindings.hull);
  let defaultDescription: ImmersiveField | null = null;
  if (selectedHull?.target.kind === 'spec' && selectedHull.target.target.kind === 'skin') {
    const base = field(selectedHull.key, 'baseHullId', '基础船体/Skin', 'enum');
    base.schema.source = 'hull:ids';
    base.schema.required = true;
    base.handoff = true;
    sources.push(stat('skin-base-reference', 'Skin 基础', schemaStringValue(data(selectedHull.key).baseHullId) || '引用未提供', [base]));
    const descriptor = field(selectedHull.key, 'descriptionId', '描述引用', 'enum');
    descriptor.schema.source = 'csv:descriptions.id';
    descriptor.schema.required = true;
    descriptor.handoff = true;
    sources.push(
      stat(
        'skin-description-reference',
        '描述引用',
        data(selectedHull.key).descriptionId === undefined
          ? '默认：' + selectedHull.target.target.id
          : schemaStringValue(data(selectedHull.key).descriptionId) || '描述引用为空',
        [descriptor],
      ),
    );
    if (Object.hasOwn(data(selectedHull.key), 'descriptionId')) defaultDescription = descriptor;
  }
  return {
    kind: 'wing',
    heading: [name, manufacturer],
    description,
    technical,
    system,
    systemRuns: highlightedTextParts(
      schemaStringValue(systemData.text3) || schemaStringValue(systemData.text1) || '系统说明未提供',
      schemaStringValue(systemData.text4),
    ).map((part) => ({ text: part.text, color: part.highlight ? '#ffd200' : undefined })),
    armaments: [...counts].map(([id, count]) => `${count}× ${weaponNames.get(id) || id}`).join('，') || '无',
    armamentRuns,
    sources,
    defaultDescription,
    sprite: hull?.sprite ?? null,
    preview: immersiveSnapshotScene(graph, values),
    count: number(wing.num, NaN),
    formation: schemaStringValue(wing.formation),
    allStats: [name, manufacturer, description, ...technical, system, ...sources],
  };
}
