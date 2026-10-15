import { describe, expect, it } from 'vitest';
import {
  hullmodColumns,
  hullmodListHeight,
  hullmodDescription,
  hullmodDesign,
  hullmodFilterOptions,
  hullmodMatches,
  hullmodRowState,
  sortHullmods,
  toggleHullmodFilter,
  visibleHullmod,
} from './variant-hullmods';
import type { JointVariantEntry, RowData } from '@/shared/types';
import type { VariantHullmod } from './variant-panel';
const source = { source: 'mod' as const, root: 'M:/mod', path: 'M:/mod/hull_mods.csv', relPath: 'hull_mods.csv' };
const entry = (id: string, data: RowData): JointVariantEntry => ({
  id,
  label: id,
  data,
  source,
  sourceVersion: { path: source.path, fingerprint: 'v' },
  resourceRefs: {},
  spec: null,
  specSource: null,
  specVersion: null,
  preview: null,
  projectile: null,
  primaryRole: null,
});
describe('original hullmod selector projection', () => {
  it('keeps whole rows while auxiliary controls change the available height', () => {
    expect(hullmodListHeight(708, 88, 55)).toBe(506);
    expect(hullmodListHeight(628, 116, 55)).toBe(398);
    expect(hullmodListHeight(708, 88, 140)).toBe(398);
  });
  it.each([
    [729, [300, 200, 100, 120]],
    [867, [353, 251, 117, 137]],
    [547, [238, 120, 60, 120]],
    [1187, [473, 371, 157, 177]],
  ])('distributes the original four columns in %s pixels', (width, expected) => {
    expect(hullmodColumns(width as number)).toEqual(expected);
    expect(hullmodColumns(width as number).reduce((sum, value) => sum + value, 9)).toBe(width);
  });
  it('normalizes original Common design, static hidden flags and deduplicated filter counts', () => {
    const rows = [
      entry('a', { uiTags: 'Flux, Flux, Weapons' }),
      entry('b', { 'tech/manufacturer': 'High Tech', uiTags: 'Flux' }),
      entry('c', { hidden: 'TRUE' }),
      entry('d', { hiddenEverywhere: 'true' }),
      entry('', {}),
    ];
    expect(rows.filter(visibleHullmod).map((value) => value.id)).toEqual(['a', 'b']);
    expect(hullmodDesign(rows[0]!)).toBe('Common');
    expect(hullmodFilterOptions(rows.slice(0, 2), 'tags')).toEqual([
      { value: 'Flux', label: 'Flux', count: 2 },
      { value: 'Weapons', label: 'Weapons', count: 1 },
    ]);
    expect(hullmodFilterOptions(rows.slice(0, 2), 'design').map((value) => value.value)).toEqual(['Common', 'High Tech']);
  });
  it('applies ordinary, modifier and whole-group selection including last item reset', () => {
    const options = ['Common', 'High Tech', 'Low Tech'].map((value) => ({ value, label: value, count: 1 }));
    expect(toggleHullmodFilter(null, options, 'High Tech', false)).toEqual(['High Tech']);
    expect(toggleHullmodFilter(['High Tech'], options, 'Common', true)).toEqual(['High Tech', 'Common']);
    expect(toggleHullmodFilter(['High Tech', 'Common'], options, 'High Tech', true)).toEqual(['Common']);
    expect(toggleHullmodFilter(['Common'], options, 'Common', true)).toBeNull();
    expect(toggleHullmodFilter(null, options, null, false)).toEqual([]);
    expect(toggleHullmodFilter([], options, null, false)).toBeNull();
    expect(hullmodMatches(entry('a', { uiTags: 'Flux,Weapons' }), ['Common'], ['Flux'])).toBe(true);
    expect(hullmodMatches(entry('a', { uiTags: 'Flux' }), ['High Tech'], null)).toBe(false);
    expect(hullmodMatches(entry('a', { uiTags: 'Flux' }), null, [])).toBe(false);
  });
  it('sorts current hull cost descending with stable equal costs and missing source at the end', () => {
    const rows = [
      entry('a', { cost_cruiser: '5' }),
      entry('b', { cost_cruiser: '20' }),
      entry('c', { cost_cruiser: '10' }),
      entry('d', { cost_cruiser: '20' }),
      entry('e', {}),
    ];
    expect(sortHullmods([...rows], 'cost', false, 'CRUISER', () => undefined).map((value) => value.id)).toEqual(['b', 'd', 'c', 'a', 'e']);
    expect(sortHullmods([...rows], 'cost', true, 'CRUISER', () => undefined).map((value) => value.id)).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(sortHullmods([...rows], 'name', false, 'CRUISER', () => undefined).map((value) => value.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });
  it('projects typed installation status, zero-cost membership and editable budget diagnostics', () => {
    const row = entry('a', { cost_cruiser: '20' });
    const mod: VariantHullmod = { id: 'a', name: 'a', design: 'Common', cost: 0, category: 's', strengthened: false, icon: null };
    expect(hullmodRowState(row, mod, 'CRUISER', 10)).toMatchObject({
      iconKey: 'checkmark_unlocked',
      color: '#cc99ff',
      costText: '—',
      diagnostic: '',
    });
    expect(hullmodRowState(row, { ...mod, category: 'builtin' }, 'CRUISER', 10)).toMatchObject({
      iconKey: 'checkmark_locked',
      iconColor: '#afafaf',
    });
    expect(hullmodRowState(row, undefined, 'CRUISER', 10)).toMatchObject({
      costColor: '#ff6400',
      costText: '20',
      diagnostic: expect.stringContaining('超预算'),
    });
    expect(hullmodRowState(entry('missing', {}), undefined, 'CRUISER', 10).diagnostic).toContain('missing');
  });
  it('retains static text, escaped percent, indexed script parameters and paragraph sequence', () => {
    const result = hullmodDescription('Boost %s then %s and %% plus %1$s');
    expect(result.runs.map((value) => value.text).join('')).toBe('Boost [脚本参数 1] then [脚本参数 2] and % plus [脚本参数 1]');
    expect(result.parameters).toBe(3);
    expect(
      hullmodDescription('%2$s then %s')
        .runs.map((value) => value.text)
        .join(''),
    ).toBe('[脚本参数 2] then [脚本参数 1]');
    expect(
      hullmodDescription('Next %s', 2)
        .runs.map((value) => value.text)
        .join(''),
    ).toBe('Next [脚本参数 3]');
    expect(hullmodDescription('<b>plain</b>').runs).toEqual([{ text: '<b>plain</b>' }]);
  });
});
