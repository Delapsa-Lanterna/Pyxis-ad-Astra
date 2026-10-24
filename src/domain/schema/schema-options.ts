import type { ResourceRef, ResourceSource, SourceOptionGroup } from '@/shared/types';
import type { FieldSchema } from '@/domain/schema/schema.types';
import type { DeepReadonly } from '@/shared/types';
import { schemaArrayStringValues, schemaKeyValueEntries, schemaStringValue, schemaTagValues } from '@/domain/schema/schema-values';

export interface SelectOption {
  label: string;
  value: string;
  description?: string | null;
  resourceRef?: Readonly<ResourceRef> | null;
  templateValue?: string;
  templateMax?: number;
  type?: 'group';
  key?: string;
  children?: SelectOption[];
}

export interface FlatSelectOption {
  description?: string | null;
  label: string;
  resourceRef?: Readonly<ResourceRef> | null;
  value: string;
  templateValue?: string;
  templateMax?: number;
}

export interface SelectOptionGroup {
  key: string;
  label: string;
  options: FlatSelectOption[];
}

const CURRENT_VALUE_OPTION_GROUP = {
  key: 'group:当前值',
  label: '当前值',
  value: '__current',
} as const;

export function sourceGroupLabel(origin: ResourceSource): string {
  return origin === 'core' ? '原版' : '当前 Mod';
}

export function selectOptionValueExists(options: SelectOption[], value: string): boolean {
  return options.some(
    (option) =>
      (!option.templateValue && option.value === value) || option.children?.some((child) => !child.templateValue && child.value === value),
  );
}

export function isSelectOptionGroup(option: SelectOption): boolean {
  return option.type === 'group';
}

export function selectOptionText(option: SelectOption): string {
  return option.label || option.value;
}

export function flattenSelectOptions(options: SelectOption[]): FlatSelectOption[] {
  return options
    .flatMap((option) => (isSelectOptionGroup(option) ? (option.children ?? []).map(flatSelectOption) : [flatSelectOption(option)]))
    .filter((option) => option.templateValue === undefined);
}

export function groupSelectOptions(options: SelectOption[]): SelectOptionGroup[] {
  const groups: SelectOptionGroup[] = [];
  const ungrouped: FlatSelectOption[] = [];
  for (const option of options) {
    if (isSelectOptionGroup(option)) {
      groups.push({
        key: option.value,
        label: selectOptionText(option),
        options: (option.children ?? []).map(flatSelectOption),
      });
    } else {
      ungrouped.push(flatSelectOption(option));
    }
  }
  if (ungrouped.length > 0) groups.unshift({ key: '__ungrouped', label: '', options: ungrouped });
  return groups;
}

export function includeCurrentSelectOptions(options: SelectOption[], values: string[]): SelectOption[] {
  const seen = new Set<string>();
  const current = values
    .filter((value) => {
      if (value.length === 0 || seen.has(value) || selectOptionValueExists(options, value)) return false;
      seen.add(value);
      return true;
    })
    .map((value) => numericSelectOption(options, value) ?? { label: value, value });
  if (current.length === 0) return options;
  return [{ type: 'group', ...CURRENT_VALUE_OPTION_GROUP, children: current }, ...options];
}

export function schemaEnumSelectOptions(field: FieldSchema, sourceOptions: SelectOption[]): SelectOption[] {
  if (field.options && field.options.length > 0) return field.options.map((option) => ({ label: option, value: option }));
  return sourceOptions;
}

export function numericSelectOption(options: SelectOption[], value: string): SelectOption | undefined {
  for (const option of options.flatMap((group) => group.children ?? [group])) {
    if (option.templateValue === undefined) continue;
    const prefix = option.templateValue.slice(0, -1);
    if (!value.startsWith(prefix)) continue;
    const suffix = value.slice(prefix.length);
    if (/^\d+$/.test(suffix) && Number(suffix) <= option.templateMax!) {
      return { label: option.label.replace(option.value, value), value, description: option.description };
    }
  }
}

export function fieldSourceCurrentValues(field: FieldSchema, value: unknown): string[] {
  if (field.type === 'string-array') return schemaArrayStringValues(value);
  if (field.type === 'tag-select') return schemaTagValues(value);
  if (field.type === 'object') return schemaKeyValueEntries(value, field.format).map((entry) => entry.key);
  const text = schemaStringValue(value);
  return text ? [text] : [];
}

export function mapSourceGroupsToSelectOptions(groups: DeepReadonly<SourceOptionGroup[]>): SelectOption[] {
  const options: SelectOption[] = groups
    .map((group): SelectOption => {
      const label = sourceGroupLabel(group.origin);
      return {
        type: 'group',
        key: `group:${label}`,
        label,
        value: label,
        children: group.options
          .filter((option) => option.templateValue === undefined)
          .map((option) => ({
            label: option.label,
            value: option.value,
            description: option.description,
            resourceRef: option.resourceRef ?? null,
          })),
      };
    })
    .filter((group) => group.children!.length > 0);
  const templates = groups.flatMap((group) => group.options.filter((option) => option.templateValue !== undefined));
  if (templates.length)
    options.push({
      type: 'group',
      key: 'group:numeric-tags',
      label: '数字标签',
      value: '__numeric-tags',
      children: templates.map((option) => ({
        label: option.label,
        value: option.value,
        description: option.description,
        resourceRef: null,
        templateValue: option.templateValue,
        templateMax: option.templateMax,
      })),
    });
  return options;
}

function flatSelectOption(option: SelectOption): FlatSelectOption {
  return {
    label: selectOptionText(option),
    description: option.description ?? null,
    resourceRef: option.resourceRef ?? null,
    value: option.value,
    templateValue: option.templateValue,
    templateMax: option.templateMax,
  };
}
