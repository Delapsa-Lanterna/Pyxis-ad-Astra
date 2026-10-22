import { describe, expect, it } from 'vitest';
import {
  fieldSourceCurrentValues,
  includeCurrentSelectOptions,
  mapSourceGroupsToSelectOptions,
  type SelectOption,
} from '@/domain/schema/schema-options';
import type { FieldSchema } from '@/domain/schema/schema.types';

const catalog: SelectOption[] = [
  {
    type: 'group',
    label: '当前 Mod',
    value: '当前 Mod',
    children: [{ label: 'Legal', value: 'legal' }],
  },
];

describe('source option ghost values', () => {
  it.each([
    ['enum', ' legacy '],
    ['string-array', ['legal', ' legacy ']],
    ['tag-select', { tags: ['legal', ' legacy '] }],
    ['key-value', { legal: 1, ' legacy ': 2 }],
  ] as const)('preserves exact ghost text for %s', (type, value) => {
    const field = { key: 'value', label: 'Value', type, source: 'csv:ships.id' } as FieldSchema;
    const values = fieldSourceCurrentValues(field, value);
    const options = includeCurrentSelectOptions(catalog, values);
    const ghost = options[0]?.children?.find((option) => option.value === ' legacy ');

    expect(ghost).toEqual({ label: ' legacy ', value: ' legacy ' });
  });

  it('uses character identity and treats only the empty string as unselected', () => {
    const options = includeCurrentSelectOptions(catalog, ['', 'legal', ' legal ', '   ']);
    const ghosts = options[0]?.children?.map((option) => option.value);

    expect(ghosts).toEqual([' legal ', '   ']);
  });

  it('keeps numeric templates separate from values and annotates valid current values', () => {
    const options = mapSourceGroupsToSelectOptions([
      {
        origin: 'core',
        options: [
          {
            label: 'kinetic* (动能)',
            value: 'kinetic*',
            description: '武器分类',
            resourceRef: null,
            origin: 'core',
            templateValue: 'kinetic0',
            templateMax: 99,
          },
          { label: 'kinetic2 (动能 2)', value: 'kinetic2', description: '具体级别', resourceRef: null, origin: 'core' },
        ],
      },
    ]);
    expect(options.map((group) => group.label)).toEqual(['原版', '数字标签']);
    expect(options[0]!.children?.map((option) => option.value)).toEqual(['kinetic2']);
    expect(options[1]!.children?.[0]).toMatchObject({ value: 'kinetic*', templateValue: 'kinetic0', templateMax: 99 });
    expect(includeCurrentSelectOptions(options, ['kinetic42'])[0]!.children?.[0]).toMatchObject({
      label: 'kinetic42 (动能)',
      value: 'kinetic42',
      description: '武器分类',
    });
    expect(includeCurrentSelectOptions(options, ['kinetic100'])[0]!.children?.[0]).toEqual({
      label: 'kinetic100',
      value: 'kinetic100',
    });
  });
});
