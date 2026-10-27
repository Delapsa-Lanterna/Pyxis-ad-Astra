import { immersiveNumber } from '../fields';
import type { ReadonlyVariantEntry, RowData } from '@/shared/types';
import type { VariantHullmod } from './variant-panel';
import { isRowData } from '@/shared/lib/row-data';
import { schemaStringValue, parseSchemaPlainBoolean } from '@/domain/schema/schema-values';
import type { TextRun } from '@/domain/fonts/font.types';

export type HullmodSort = 'name' | 'design' | 'cost' | 'installed';
export interface HullmodFilterOption {
  value: string;
  label: string;
  count: number;
}
export const hullmodData = (entry: ReadonlyVariantEntry): RowData => (isRowData(entry.data) ? entry.data : {});
export const hullmodString = (entry: ReadonlyVariantEntry, key: string): string => schemaStringValue(hullmodData(entry)[key]);
export const hullmodDesign = (entry: ReadonlyVariantEntry): string => hullmodString(entry, 'tech/manufacturer') || 'Common';
export const hullmodTags = (entry: ReadonlyVariantEntry): string[] => [
  ...new Set(
    hullmodString(entry, 'uiTags')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  ),
];
export const visibleHullmod = (entry: ReadonlyVariantEntry): boolean =>
  Boolean(entry.id) && !['hidden', 'hiddenEverywhere'].some((key) => parseSchemaPlainBoolean(hullmodString(entry, key)) === true);
export function hullmodCost(entry: ReadonlyVariantEntry, hullSize: string): number {
  const key =
    ({ FRIGATE: 'cost_frigate', DESTROYER: 'cost_dest', CRUISER: 'cost_cruiser', CAPITAL_SHIP: 'cost_capital' } as Record<string, string>)[
      hullSize
    ] ?? 'cost_frigate';
  return immersiveNumber(hullmodData(entry), key, NaN);
}
export function hullmodColumns(width: number): number[] {
  const result = [300, 200, 100, 120],
    extra = width - 729;
  if (extra >= 0) {
    const parts = [3, 3, 1, 1].map((weight) => Math.trunc((extra * weight) / 8));
    parts[0]! += extra - parts.reduce((sum, part) => sum + part, 0);
    return result.map((value, index) => value + parts[index]!);
  }
  let deficit = -extra;
  for (const [index, minimum] of [
    [3, 120],
    [2, 60],
    [1, 120],
    [0, 150],
  ]) {
    const change = Math.min(deficit, result[index!]! - minimum!);
    result[index!]! -= change;
    deficit -= change;
  }
  return result;
}
export function hullmodListHeight(height: number, filters: number, auxiliary: number): number {
  return Math.max(36, Math.floor((height - 23 - filters - auxiliary - 25 - 2) / 36) * 36) + 2;
}
export function hullmodFilterOptions(entries: readonly ReadonlyVariantEntry[], kind: 'design' | 'tags'): HullmodFilterOption[] {
  const counts = new Map<string, number>();
  for (const entry of entries)
    for (const value of kind === 'design' ? [hullmodDesign(entry)] : hullmodTags(entry)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([value, count]) => ({ value, label: value, count }));
}
export function toggleHullmodFilter(
  current: readonly string[] | null,
  options: readonly HullmodFilterOption[],
  value: string | null,
  additive: boolean,
): string[] | null {
  const all = options.map((option) => option.value),
    selected = current === null ? all : [...current];
  if (value === null) return selected.length === all.length ? [] : null;
  const next = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
  if (!next.length) return null;
  if (!additive) return [value];
  return next.length === all.length ? null : next;
}
export function hullmodMatches(entry: ReadonlyVariantEntry, designs: readonly string[] | null, tags: readonly string[] | null): boolean {
  return (
    (designs === null || designs.includes(hullmodDesign(entry))) && (tags === null || hullmodTags(entry).some((tag) => tags.includes(tag)))
  );
}
export function sortHullmods(
  entries: ReadonlyVariantEntry[],
  key: HullmodSort,
  ascending: boolean,
  hullSize: string,
  installed: (id: string) => VariantHullmod | undefined,
): ReadonlyVariantEntry[] {
  return entries.sort((a, b) => {
    if (key === 'cost') {
      const left = hullmodCost(a, hullSize),
        right = hullmodCost(b, hullSize);
      if (Number.isNaN(left) || Number.isNaN(right)) return Number.isNaN(left) === Number.isNaN(right) ? 0 : Number.isNaN(left) ? 1 : -1;
      return ascending ? left - right : right - left;
    }
    const value = (entry: ReadonlyVariantEntry) =>
      key === 'design' ? hullmodDesign(entry) : key === 'installed' ? (installed(entry.id)?.category ?? '') : entry.label;
    const comparison = value(a).localeCompare(value(b));
    return ascending ? comparison : -comparison;
  });
}
export function hullmodRowState(entry: ReadonlyVariantEntry, installed: VariantHullmod | undefined, hullSize: string, available: number) {
  const cost = hullmodCost(entry, hullSize),
    special = installed?.category !== undefined && installed.category !== 'normal';
  const color = installed?.category === 's' || installed?.strengthened ? '#cc99ff' : installed ? '#ffd200' : '#aadeff';
  return {
    color,
    costColor: installed ? '#afafaf' : cost > available || !Number.isFinite(cost) ? '#ff6400' : '#ffd200',
    costText: special ? '—' : Number.isFinite(cost) ? String(cost) : '—',
    iconKey: installed
      ? installed.category === 's' || installed.strengthened
        ? 'checkmark_unlocked'
        : installed.category === 'normal'
          ? 'checkmark'
          : 'checkmark_locked'
      : '',
    iconColor: installed?.category === 'builtin' && !installed.strengthened ? '#afafaf' : color,
    label: installed
      ? { normal: '普通', permanent: '永久', s: 'S 插件', builtin: '内置' }[installed.category] +
        (installed.strengthened ? ' · S 强化效果' : '')
      : '未安装',
    diagnostic: !Number.isFinite(cost)
      ? '装配点数来源未确定：' + entry.id
      : !installed && cost > available
        ? '装配点数超预算：' + cost + '，剩余 ' + available
        : '',
  };
}
export function hullmodDescription(raw: string, start = 0): { runs: TextRun[]; parameters: number; nextIndex: number } {
  let parameters = 0,
    offset = 0;
  let nextIndex = start;
  const runs: TextRun[] = [];
  for (const match of raw.matchAll(/%%|%(?:(\d+)\$)?s/g)) {
    runs.push({ text: raw.slice(offset, match.index) });
    if (match[0] === '%%') runs.push({ text: '%' });
    else {
      parameters++;
      runs.push({ text: '[脚本参数 ' + (match[1] ?? ++nextIndex) + ']', color: '#ffd200' });
    }
    offset = match.index! + match[0].length;
  }
  runs.push({ text: raw.slice(offset) });
  return { runs, parameters, nextIndex };
}
