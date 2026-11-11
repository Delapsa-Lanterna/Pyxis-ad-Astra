import { describe, expect, it } from 'vitest';
import type { FieldProblem, JointEditKind, JointEditRecord, JointEditSnapshot } from '@/shared/types';
import { variantJointFixture } from '@/test/fixtures/joint-edit/variant-joint-edit';
import { weaponJointFixture } from '@/test/fixtures/joint-edit/weapon-joint-edit';
import { wingJointFixture } from '@/test/fixtures/joint-edit/wing-joint-edit';
import { fixtureCsvRecord, fixtureSpecRecord } from '@/test/fixtures/joint-edit/joint-record';
import { jointObject } from '@/domain/joint-edit';
import { immersiveUsedRecords, immersiveRecordProblems } from './source-records';

function graph(kind: JointEditKind = 'variant') {
  if (kind === 'weapon') return weaponJointFixture();
  const snapshot = variantJointFixture();
  snapshot.root.kind = kind;
  if (kind === 'wing') {
    snapshot.bindings.csv = 'wing';
    snapshot.records.find((record) => record.key === 'wing')!.value = {
      state: 'present',
      value: { id: 'sarissa_wing', variant: 'aurora_refit' },
    };
  }
  if (kind === 'ship' || kind === 'skin') {
    snapshot.bindings = { spec: 'spec', csv: 'csv', description: 'description' };
    snapshot.hull!.variantKey = 'spec';
    snapshot.hull!.weapons = { ...snapshot.hull!.builtInWeapons };
    snapshot.variants = {};
    if (kind === 'skin') {
      snapshot.records.push(fixtureSpecRecord('skin', 'skin', { skinHullId: 'overlay', baseHullId: 'aurora' }));
      snapshot.bindings.spec = 'skin';
      snapshot.hull!.skinKeys = ['skin'];
      snapshot.hull!.variantKey = 'skin';
    }
  }
  return snapshot;
}
function problem(record: JointEditRecord, rowKey?: string): FieldProblem {
  return {
    severity: 'warning',
    code: 'fixture.warning',
    path: record.key,
    message: record.key,
    location: {
      path: record.source!.path,
      rowKey: rowKey ?? (record.target.kind === 'csv' ? record.target.rowKey : undefined),
      field: 'id',
      line: null,
      column: null,
    },
  };
}
const keys = (snapshot: JointEditSnapshot) => immersiveUsedRecords(snapshot).map((record) => record.key);

describe('immersive component problems', () => {
  it('selects the active weapon branch and follows a replacement projectile', () => {
    const snapshot = graph('weapon'),
      record = snapshot.records[0]!;
    record.value = { state: 'present', value: { ...jointObject(record.value), specClass: 'beam' } };
    expect(keys(snapshot)).not.toContain('projectile');
    const replacement = fixtureSpecRecord('replacement-shot', 'projectile', { id: 'replacement-shot' });
    snapshot.records.push(replacement);
    record.value = {
      state: 'present',
      value: { ...jointObject(record.value), specClass: 'projectile', projectileSpecId: 'replacement-shot' },
    };
    expect(keys(snapshot)).toContain('replacement-shot');
    expect(keys(snapshot)).not.toContain('projectile');
  });
  it.each(['ship', 'skin', 'weapon', 'wing', 'variant'] as const)('selects used weapon and projectile problems for %s', (kind) => {
    const snapshot = graph(kind),
      prefix = kind === 'weapon' ? '' : 'weapon-';
    const record = snapshot.records.find((record) => record.key === prefix + 'csv')!;
    const used = problem(record),
      other = problem(record, 'unused-row');
    expect(immersiveRecordProblems(immersiveUsedRecords(snapshot), [used, other])).toEqual([used]);
    expect(keys(snapshot)).toContain(prefix + 'projectile');
  });
  it('traverses fighter equipment and shared recursive modules once', () => {
    const snapshot = graph(),
      fighter = wingJointFixture();
    const remap = (key: string) => 'fighter-' + key;
    for (const record of fighter.records.filter((record) => record.key !== 'wing'))
      snapshot.records.push({ ...record, key: remap(record.key) });
    const hull = structuredClone(fighter.hull!);
    hull.variantKey = remap(hull.variantKey);
    hull.hullKey = remap(hull.hullKey);
    hull.fields = Object.fromEntries(
      Object.entries(hull.fields).map(([key, fields]) => [key, fields.map((field) => ({ ...field, recordKey: remap(field.recordKey) }))]),
    );
    hull.displayBindings = Object.fromEntries(Object.entries(hull.displayBindings).map(([key, value]) => [key, remap(value)]));
    hull.slots = jointObject(fighter.records[0]!.value).weaponSlots as typeof hull.slots;
    snapshot.variants[hull.variantKey] = hull;
    snapshot.hull!.modules = [
      { slotId: 'one', variantKey: hull.variantKey },
      { slotId: 'two', variantKey: hull.variantKey },
    ];
    snapshot.records.push(
      fixtureSpecRecord('fighter-weapon-spec', 'weapon', { id: 'lightac', projectileSpecId: 'fighter-shot' }),
      fixtureSpecRecord('fighter-shot', 'projectile', { id: 'fighter-shot' }),
    );
    const selected = keys(snapshot);
    expect(selected).toContain('fighter-weapon');
    expect(selected).toContain('fighter-shot');
    expect(selected.filter((key) => key === hull.variantKey)).toHaveLength(1);
    expect(selected.filter((key) => key === 'fighter-weapon-spec')).toHaveLength(1);
  });
  it('uses the effective skin equipment and installed plugin categories', () => {
    const snapshot = graph('skin');
    snapshot.hull!.weapons = {};
    snapshot.hull!.builtInWeapons = {};
    snapshot.hull!.builtInMods = ['effective'];
    snapshot.records.push(fixtureCsvRecord('effective', 'hullmods', { id: 'effective' }, { id: 'effective' }));
    const selected = keys(snapshot);
    expect(selected).toContain('skin');
    expect(selected).toContain('spec');
    expect(selected).toContain('effective');
    expect(selected).not.toContain('weapon-spec');
    expect(selected).not.toContain('mod');
    const variant = graph();
    const record = variant.records.find((record) => record.key === 'variant')!;
    record.value = {
      state: 'present',
      value: { ...jointObject(record.value), hullMods: [], permaMods: ['rangefinder'], sMods: ['rangefinder'] },
    };
    expect(keys(variant).filter((key) => key === 'mod')).toEqual(['mod']);
  });
  it('honors builtin wing precedence and missing component records', () => {
    const snapshot = graph();
    snapshot.hull!.builtInWings = ['builtin'];
    const builtin = fixtureCsvRecord('builtin', 'wings', { id: 'builtin' }, { id: 'builtin' });
    builtin.value = { state: 'missing' };
    snapshot.records.push(builtin);
    const selected = keys(snapshot);
    expect(selected).toContain('builtin');
    expect(selected).not.toContain('wing');
  });
  it('retains input, file, duplicate and composed-source issues at their exact locations', () => {
    const snapshot = graph('weapon'),
      row = snapshot.records[1]!,
      spec = snapshot.records[0]!;
    row.source = { ...row.source!, source: 'core', path: 'G:/core/weapon_data.csv' };
    spec.composition = {
      replace: false,
      excluded: [],
      layers: [
        {
          source: { ...spec.source!, source: 'core', path: 'G:/core/a.wpn' },
          version: { path: 'G:/core/a.wpn', fingerprint: 'one' },
          replace: false,
          data: {},
        },
      ],
    };
    const issues: FieldProblem[] = [
      problem(row),
      { ...problem(row), code: 'csv.identity_duplicate' },
      { ...problem(row), code: 'csv.column_missing', location: { ...problem(row).location!, rowKey: undefined } },
      { ...problem(row), code: 'fixture.read', location: { ...problem(row).location!, rowKey: undefined, field: undefined } },
      { ...problem(spec), location: { ...problem(spec).location!, path: 'G:/core/a.wpn' } },
      { severity: 'error', code: 'field.input_invalid', path: 'active', message: 'Raw input' },
    ];
    expect(immersiveRecordProblems(immersiveUsedRecords(snapshot), issues)).toEqual(issues);
    expect(issues[0]!.location?.path).toBe('G:/core/weapon_data.csv');
  });
  it('updates membership from accepted replacement, removal and restored graphs', () => {
    const original = graph(),
      replaced = structuredClone(original);
    replaced.hull!.weapons = {};
    replaced.hull!.builtInWeapons = {};
    expect(keys(replaced)).not.toContain('weapon-projectile');
    expect(keys(original)).toContain('weapon-projectile');
    const other = fixtureSpecRecord('replacement', 'weapon', { id: 'replacement' });
    replaced.records.push(other);
    replaced.hull!.weapons.WS2 = 'replacement';
    expect(keys(replaced)).toContain('replacement');
    expect(keys(original)).not.toContain('replacement');
  });
});
