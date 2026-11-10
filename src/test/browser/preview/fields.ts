import { FIELD_TYPES, type FieldSchema } from '@/domain/schema/schema.types';
import { getSchema } from '@/domain/schema/config-schema-registry';
import type { RowData } from '@/shared/types';

const text = { key: 'value', label: '内容', type: 'string' } as const;
const examples: RowData = {
  string: 'Sample',
  text: '第一行\n第二行',
  integer: 3,
  float: 0.5,
  boolean: true,
  enum: 'A',
  'color-rgb': [80, 120, 200],
  'color-rgba': [80, 120, 200, 128],
  'path-image': 'graphics/sample.svg',
  path: 'data/sample.json',
  'string-array': ['A'],
  'tag-select': { tags: ['sample'] },
  object: { value: '嵌套内容' },
  array: ['first'],
  json: { nested: true },
};
const variantFields = getSchema('variant')!.sections!.flatMap(({ fields }) => fields);
export const collectionFields: FieldSchema[] = [
  { ...variantFields.find(({ key }) => key === 'weaponGroups')!.item!.nested!.find(({ key }) => key === 'weapons')!, key: 'weapons' },
  { ...variantFields.find(({ key }) => key === 'modules')!, key: 'modulesObject', label: '模块对象' },
  { ...variantFields.find(({ key }) => key === 'modules')!, key: 'modulesArray', label: '模块数组' },
  { key: 'dictionary', label: '字典', type: 'object', allowExtraFields: true, valueSchema: text },
  {
    key: 'groups',
    label: '嵌套分组',
    type: 'object',
    presentation: 'groups',
    allowExtraFields: true,
    valueSchema: { key: 'group', label: '分组', type: 'object', allowExtraFields: true, valueSchema: text },
  },
];
export const galleryFields: FieldSchema[] = [
  ...FIELD_TYPES.map((type): FieldSchema => ({
    key: type,
    label: type,
    type,
    ...(type === 'enum' ? { options: ['A', 'B'] } : {}),
    ...(type === 'object' ? { nested: [text] } : {}),
    ...(type === 'array' ? { item: text } : {}),
    ...(type === 'integer' || type === 'float' ? { min: 0, max: 10 } : {}),
  })),
  ...collectionFields,
];
export function fieldValues(): RowData {
  return {
    ...structuredClone(examples),
    weapons: {},
    modulesObject: {},
    modulesArray: [],
    dictionary: { first: 'A' },
    groups: { first: { text: '保留输入' } },
  };
}
export const fieldStates = ['normal', 'required', 'readonly', 'empty', 'long'] as const;
