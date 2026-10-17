import { describe, expect, it } from 'vitest';
import { applyJointConflictChoices, conflictValueText, jointWriteTargets, rebaseJointDraft } from './joint-edit';
import { shipJointFixture, jointFixtureValues } from '@/test/joint-edit';
import type { JointEditPrepared, JointValue, JointEditSnapshot } from '@/shared/types';
const present = (value: import('@/shared/types').JsonValue): JointValue => ({ state: 'present', value });
describe('joint edit field and physical target projection', () => {
  it('uses the authoritative root binding when a row read has advanced beyond the identity event', () => {
    const before = shipJointFixture();
    const after = structuredClone(before);
    const record = before.records[0]!;
    if (record.target.kind !== 'spec') throw new Error('spec fixture');
    after.root.id = 'latest';
    after.records[0]!.target = { kind: 'spec', target: { ...record.target.target, id: 'latest' } };
    after.records[0]!.value = present({ hullId: 'latest', hullSize: 'FRIGATE' });
    const result = rebaseJointDraft(
      jointFixtureValues(before),
      before,
      after,
      [{ before: record.target.target, after: { ...record.target.target, id: 'intermediate' } }],
      [],
    );
    expect(result.spec).toMatchObject({ state: 'present', value: { hullId: 'latest' } });
  });
  it('keeps only post-submit changes while accepting actual merged fields and constructed content', () => {
    const before = shipJointFixture();
    const submitted = jointFixtureValues(before);
    const later = structuredClone(submitted);
    const after = structuredClone(before);
    if (later.csv!.state !== 'present') throw new Error('csv fixture');
    const data = later.csv!.value as Record<string, import('@/shared/types').JsonValue>;
    data.name = 'Later name';
    delete data.cargo;
    const record = after.records.find((record) => record.key === 'csv')!;
    record.value = present({ ...data, name: 'Submitted name', cargo: '40', hitpoints: '1900', newColumn: 'disk' });
    const result = rebaseJointDraft(later, before, after, [], [], submitted);
    expect(result.csv).toMatchObject({ state: 'present', value: { name: 'Later name', hitpoints: '1900', newColumn: 'disk' } });
    if (result.csv!.state === 'present') expect(result.csv!.value).not.toHaveProperty('cargo');
    expect(result.csv).not.toBe(record.value);
  });
  it('adopts the authoritative fields for an unchanged identity-follow draft', () => {
    const before = shipJointFixture();
    const after = structuredClone(before);
    after.root.id = 'renamed';
    const original = before.records[0]!;
    if (original.target.kind !== 'spec') throw new Error('spec fixture');
    const target = { ...original.target.target, id: 'renamed' };
    after.records[0]!.target = { kind: 'spec', target };
    after.records[0]!.value = present({ hullId: 'renamed', hullSize: 'DESTROYER', external: 'current' });
    const result = rebaseJointDraft(jointFixtureValues(before), before, after, [{ before: original.target.target, after: target }], []);
    expect(result.spec).toEqual(after.records[0]!.value);
  });
  it('maps a changed root description binding and preserves only its edited content', () => {
    const before = shipJointFixture();
    const after = structuredClone(before);
    const next = after.records.find((record) => record.key === 'description')!;
    next.key = 'new-description';
    after.bindings.description = next.key;
    if (next.target.kind !== 'csv') throw new Error('CSV fixture');
    next.target = { ...next.target, rowKey: 'new-row', identity: { id: 'renamed', type: 'SHIP' } };
    next.value = { state: 'missing' };
    const values = jointFixtureValues(before);
    const clean = rebaseJointDraft(values, before, after, [], []);
    expect(clean['new-description']).toEqual({ state: 'missing' });
    expect(clean).not.toHaveProperty('description');
    if (values.description!.state === 'present') values.description!.value = { id: 'lasher', type: 'SHIP', text1: 'My edited description' };
    const dirty = rebaseJointDraft(values, before, after, [], []);
    expect(dirty['new-description']).toEqual(present({ id: 'renamed', type: 'SHIP', text1: 'My edited description' }));
    expect(dirty).not.toHaveProperty('description');
  });
  it('applies independent field choices while preserving raw text, arrays, absent and null values', () => {
    const snapshot = {
      root: { sessionId: 's', modRoot: 'M:/mod', kind: 'ship', id: 'a' },
      bindings: {},
      referenceSettings: { values: {}, versions: [], resources: {} },
      records: [],
      baseVersions: [],
      hull: null,
      variants: {},
      catalog: null,
      newSources: [],
    } as JointEditSnapshot;
    const values = JSON.parse(
      '{"r":{"state":"present","value":{"nested":{"a":1},"__proto__":"disk","array":[2],"text":"disk","gone":null}}}',
    ) as Record<string, JointValue>;
    const conflicts = [
      { recordKey: 'r', path: ['nested', 'a'], baseline: present(0), disk: present(1), draft: present(3) },
      { recordKey: 'r', path: ['__proto__'], baseline: present('before'), disk: present('disk'), draft: present('draft') },
      { recordKey: 'r', path: ['array'], baseline: present([1]), disk: present([2]), draft: present([3, 4]) },
      { recordKey: 'r', path: ['text'], baseline: present('before'), disk: present('disk'), draft: present('{unfinished') },
      { recordKey: 'r', path: ['gone'], baseline: present(1), disk: present(null), draft: { state: 'missing' } as JointValue },
    ];
    const prepared: JointEditPrepared = { snapshot, values, conflicts };
    const merged = applyJointConflictChoices(
      prepared,
      conflicts.map((conflict) => ({ recordKey: conflict.recordKey, path: conflict.path, choice: 'draft' })),
    );
    expect(merged.r).toEqual(present(JSON.parse('{"nested":{"a":3},"__proto__":"draft","array":[3,4],"text":"{unfinished"}')));
    expect(values.r).toEqual(present(JSON.parse('{"nested":{"a":1},"__proto__":"disk","array":[2],"text":"disk","gone":null}')));
  });
  it('distinguishes missing, null and raw empty values in conflict presentation', () => {
    expect(conflictValueText({ state: 'missing' })).toBe('字段不存在');
    expect(conflictValueText(present(null))).toBe('null');
    expect(conflictValueText(present(''))).toBe('""');
  });
  it('deduplicates versions and records into complete write scopes', () => {
    const snapshot: JointEditSnapshot = {
      hull: null,
      variants: {},
      catalog: null,
      newSources: [],
      root: { sessionId: 's', modRoot: 'M:/mod', kind: 'wing', id: 'wing' },
      bindings: {},
      referenceSettings: { values: {}, versions: [], resources: {} },
      baseVersions: [{ path: 'M:/mod/wings.csv', fingerprint: 'v' }],
      records: [
        {
          key: 'row',
          target: {
            kind: 'csv',
            table: 'wings',
            rowKey: 'row',
            identity: { id: 'wing' },
            write: { source: 'mod', root: 'M:/mod', relPath: 'wings.csv', path: 'M:/mod/wings.csv' },
          },
          source: null,
          sourceVersion: null,
          value: present({ id: 'wing' }),
          baseVersions: [],
          resourceRefs: {},
          referencedBy: [],
        },
      ],
    };
    expect(jointWriteTargets(snapshot)).toEqual([{ sessionId: 's', modRoot: 'M:/mod', path: 'M:/mod/wings.csv' }]);
  });
});
