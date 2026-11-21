import type { JsonValue, MiscConfigKind } from '@/shared/types';

export interface MiscConfigDefinition {
  kind: MiscConfigKind;
  label: string;
  filename: string;
  path: string;
  schema: string;
  description: string;
  initial: JsonValue;
}
export const MISC_CONFIG_DEFINITIONS: readonly MiscConfigDefinition[] = [
  {
    kind: 'strings',
    label: '文本字符串',
    filename: 'strings.json',
    path: 'data/strings/strings.json',
    schema: 'strings',
    description: '按分组保存游戏文本，通过分组名和文本键引用。',
    initial: {},
  },
  ...(
    [
      ['engineStyles', '引擎样式', 'engine_styles.json', 'engine-styles', '定义引擎尾焰、尾迹及发光贴图。'],
      ['hullStyles', '船体样式', 'hull_styles.json', 'hull-styles', '定义船体效果颜色、贴图及声音组引用。'],
      ['sounds', '声音', 'sounds.json', 'sounds', '定义音效、声音组和音乐。'],
      ['settings', '游戏设置', 'settings.json', 'game-settings', '编辑设计类型颜色及其余游戏配置。'],
    ] as const
  ).map(([kind, label, filename, schema, description]) => ({
    kind,
    label,
    filename,
    schema,
    description,
    path: 'data/config/' + filename,
    initial: {},
  })),
  {
    kind: 'customEntities',
    label: '自定义星图实体',
    filename: 'custom_entities.json',
    path: 'data/config/custom_entities.json',
    schema: 'custom-entities',
    description: '定义星图中的自定义实体、资源和插件类。',
    initial: {},
  },
  {
    kind: 'planets',
    label: '星球规格',
    filename: 'planets.json',
    path: 'data/config/planets.json',
    schema: 'planets',
    description: '定义星球、恒星和星云中心的显示规格。',
    initial: {},
  },
  {
    kind: 'defaultShipRoles',
    label: '默认舰船角色',
    filename: 'default_ship_roles.json',
    path: 'data/world/factions/default_ship_roles.json',
    schema: 'default-ship-roles',
    description: '定义默认舰船角色组中的装配权重。',
    initial: {},
  },
];

export function miscConfigDefinition(kind: string) {
  return MISC_CONFIG_DEFINITIONS.find((file) => file.kind === kind)!;
}
