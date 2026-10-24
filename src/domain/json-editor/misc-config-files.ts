import type { JsonValue, MiscConfigKind, RowData } from '@/shared/types';

export interface MiscConfigDefinition {
  kind: MiscConfigKind;
  label: string;
  filename: string;
  path: string;
  schema: string;
  description: string;
  source: string;
  initial: JsonValue;
}
export const MISC_CONFIG_FILES: readonly MiscConfigDefinition[] = [
  {
    kind: 'strings',
    label: '文本字符串',
    filename: 'strings.json',
    path: 'data/strings/strings.json',
    schema: 'strings',
    description: '按分组保存游戏文本，通过分组名和文本键引用。',
    source: 'file',
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
    source: 'file',
    initial: {},
  })),
];

export function miscConfigFile(id: string) {
  return MISC_CONFIG_FILES.find((file) => file.kind === id)!;
}
export function miscConfigValue(id: string, data: JsonValue): RowData {
  return { [miscConfigFile(id).source]: data };
}
export function miscConfigContent(id: string, value: RowData): JsonValue {
  return value[miscConfigFile(id).source]!;
}
