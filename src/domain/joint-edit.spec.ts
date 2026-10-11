import { describe, expect, it } from 'vitest';
import { editTargetsOverlap, applyJointConflictChoices, conflictValueText, jointWriteTargets } from './joint-edit';
import type { JointEditPrepared, JointValue, JointEditSnapshot } from '@/shared/types';
const present = (value: import('@/shared/types').JsonValue): JointValue => ({ state: 'present', value });
describe('joint edit field and physical target projection', () => {
  it('matches physical scope using session, normalized roots and directory boundaries', () => {
    const target = { sessionId: 's', modRoot: 'M:/mod', path: 'M:/mod/data/ships.csv' };
    expect(editTargetsOverlap(target, { ...target, path: 'm:\\MOD\\data' })).toBe(true);
    expect(editTargetsOverlap(target, { ...target, sessionId: 'new' })).toBe(false);
    expect(editTargetsOverlap(target, { ...target, path: 'M:/mod/data/ships.csv.copy' })).toBe(false);
  });
  it('applies independent field choices while preserving raw text, arrays, absent and null values', () => {
    const snapshot = {
      root: { sessionId: 's', modRoot: 'M:/mod', kind: 'ship', id: 'a' },
      records: [],
      baseVersions: [],
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
      root: { sessionId: 's', modRoot: 'M:/mod', kind: 'wing', id: 'wing' },
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
