import { describe, it, expect } from 'vitest';
import cases from '@/test/fixtures/json-composition.json';
import {
  composeJson,
  compositionOrigin,
  compositionPath,
  editComposedJson,
  setCompositionValue,
  takeReplaceBase,
} from './json-composition';
import type { JsonComposition, RowData } from '@/shared/types';
import { requireRowData } from '@/shared/lib/row-data';

function sources(base: RowData): JsonComposition {
  return {
    excluded: [],
    replace: false,
    layers: [
      {
        source: { source: 'reference', root: 'M:/base', path: 'M:/base/a.json', relPath: 'a.json' },
        version: { path: 'M:/base/a.json', fingerprint: 'saved' },
        data: base,
        replace: false,
      },
    ],
  };
}
describe('game JSON composition', () => {
  it.each(cases)('$name matches the game result', (sample) => {
    const composition = { ...sources(requireRowData(sample.base, 'base')), excluded: sample.excluded ?? [] };
    if (sample.error) expect(() => composeJson(requireRowData(sample.local, 'local'), composition)).toThrow();
    else expect(composeJson(requireRowData(sample.local, 'local'), composition)).toEqual(sample.expected);
  });
  it('keeps local edits sparse while inherited fields, arrays, false and zero remain visible', () => {
    const composition = sources({ id: 'other', name: 'base', weights: { A: 10 }, ships: ['A', 'B'], enabled: true });
    const local = { ships: ['C'] },
      before = composeJson(local, composition);
    expect(compositionOrigin(local, composition, ['weights', 'A'])).toBe('base');
    expect(compositionOrigin(local, composition, ['ships', '0'])).toBe('base');
    expect(compositionOrigin(local, composition, ['ships', '2'])).toBe(null);
    const draft = editComposedJson(local, before, { ...before, weights: { A: 0 }, enabled: false }, composition).value;
    expect(draft).toEqual({ ships: ['C'], weights: { A: 0 }, enabled: false });
    const restored = setCompositionValue(draft, ['weights', 'A'], undefined);
    expect(composeJson(restored, composition).weights).toEqual({ A: 10 });
    expect(editComposedJson(local, before, { ...before, ships: [...(before.ships as string[]), 'D'] }, composition).value).toEqual({
      ships: ['C', 'D'],
    });
    expect(compositionPath('file.shipRoles["combat.small"]["A"]')).toEqual(['file', 'shipRoles', 'combat.small', 'A']);
  });
  it('replaces the whole file when inherited array items change and leaves replacement through undo', () => {
    const composition = sources({ turretOffsets: [10, -3, 10, 3], name: 'base' });
    const local = { range: 500 },
      before = composeJson(local, composition);
    expect(before.turretOffsets).toEqual([10, -3, 10, 3]);
    const moved = { ...before, turretOffsets: [12, -3, 10, 3] };
    const edit = editComposedJson(local, before, moved, composition);
    expect(edit.notice).toContain('replace');
    expect(edit.rejected).toBe(false);
    expect(JSON.stringify(edit.value)).not.toContain('core_clearArray');
    expect(composeJson(edit.value, composition)).toEqual(moved);
    expect(compositionOrigin(edit.value, composition, ['turretOffsets', '0'])).toBe(null);
    const saved = takeReplaceBase(edit.value);
    expect(saved).toEqual({ value: moved, replace: true });
    const restored = editComposedJson(edit.value, moved, before, composition);
    expect(restored.value).toEqual(local);
    expect(takeReplaceBase(restored.value).replace).toBe(false);
  });
  it('drops an unchanged inherited prefix and rejects replacement of excluded settings files', () => {
    const composition = sources({ ships: ['A', 'B'] });
    const before = composeJson({}, composition);
    expect(editComposedJson({}, before, { ships: ['A', 'B'] }, composition).value).toEqual({});
    const settings = { ...composition, excluded: ['devMode'] };
    const rejected = editComposedJson({}, before, { ships: ['B'] }, settings);
    expect(rejected).toMatchObject({ value: {}, rejected: true });
  });
  it('applies full replacement and retains explicit empty strings', () => {
    const composition = sources({ name: 'base' });
    expect(composeJson({ name: '' }, composition).name).toBe('');
    expect(composeJson({}, { ...composition, replace: true })).toEqual({});
    composition.layers[0]!.replace = true;
    expect(composeJson({ name: 'own' }, composition)).toEqual({ name: 'base' });
  });
});
