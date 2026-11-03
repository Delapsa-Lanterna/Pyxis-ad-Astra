import {
  flattenSelectOptions,
  includeCurrentSelectOptions,
  isSelectOptionGroup,
  numericSelectOption,
  selectOptionText,
  type SelectOption,
} from '@/domain/field-editor/field-options';

export interface CsvSourceIndex {
  optionsBySource: Map<string, SelectOption[]>;
  valueIndexBySource: Map<string, Map<string, { group: string; option: SelectOption }>>;
  valueSetsBySource: Map<string, Set<string>>;
}

const EMPTY_OPTIONS: SelectOption[] = [];
const EMPTY_VALUE_SET = new Set<string>();

export function createCsvSourceIndex(
  sources: Iterable<string | undefined | null>,
  loadedOptions: Map<string, SelectOption[]> = new Map(),
): CsvSourceIndex {
  const optionsBySource = new Map<string, SelectOption[]>();
  const valueIndexBySource = new Map<string, Map<string, { group: string; option: SelectOption }>>();
  const valueSetsBySource = new Map<string, Set<string>>();

  for (const source of sources) {
    if (!source || optionsBySource.has(source)) continue;
    const options: SelectOption[] = loadedOptions.get(source) ?? [];
    optionsBySource.set(source, options);
    valueIndexBySource.set(source, createValueIndex(options));
    valueSetsBySource.set(source, createValueSet(options));
  }

  return { optionsBySource, valueIndexBySource, valueSetsBySource };
}

export function sourceOptions(index: CsvSourceIndex, source: string | undefined | null): SelectOption[] {
  return source ? (index.optionsBySource.get(source) ?? EMPTY_OPTIONS) : EMPTY_OPTIONS;
}

export function sourceValueSet(index: CsvSourceIndex, source: string | undefined | null): Set<string> {
  return source ? (index.valueSetsBySource.get(source) ?? EMPTY_VALUE_SET) : EMPTY_VALUE_SET;
}

export function sourceValue(index: CsvSourceIndex, source: string | undefined | null, value: string) {
  if (!source || !value) return null;
  const existing = index.valueIndexBySource.get(source)?.get(value);
  if (existing) return existing;
  const numeric = numericSelectOption(sourceOptions(index, source), value);
  return numeric ? { group: '原版', option: numeric } : null;
}

export function includeCurrentValue(options: SelectOption[], existingValues: Set<string>, value: string): SelectOption[] {
  return includeCurrentSelectOptions(options, [value], existingValues);
}

export function includeCurrentValues(options: SelectOption[], existingValues: Set<string>, values: string[]): SelectOption[] {
  return includeCurrentSelectOptions(options, values, existingValues);
}

function createValueIndex(options: SelectOption[]): Map<string, { group: string; option: SelectOption }> {
  const index = new Map<string, { group: string; option: SelectOption }>();
  for (const option of options) {
    if (isSelectOptionGroup(option)) {
      for (const child of option.children ?? [])
        if (!child.templateValue) index.set(child.value, { group: selectOptionText(option), option: child });
    } else if (!option.templateValue) {
      index.set(option.value, { group: '', option });
    }
  }
  return index;
}

function createValueSet(options: SelectOption[]): Set<string> {
  const values = new Set<string>();
  for (const option of flattenSelectOptions(options)) values.add(option.value);
  return values;
}
