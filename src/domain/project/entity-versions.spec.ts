import { describe, expect, it } from 'vitest';
import { entityTargetFixture } from '@/test/entity-target';
import { captureIdentityVersions, handoffTableVersions } from './entity-versions';

describe('identity version handoff', () => {
  it('retains loaded credentials for the same physical target and captures a distinct destination', () => {
    const baseline = [{ path: 'M:/mod/data/hulls/Demo.ship', fingerprint: 'loaded' }];
    for (const path of ['M:/mod/data/hulls/Demo.ship', '\\\\?\\m:\\MOD\\data\\hulls\\demo.ship']) {
      expect(captureIdentityVersions(baseline, { path, fingerprint: 'external' })).toBe(baseline);
    }
    const destination = { path: 'M:/mod/data/hulls/Next.ship', fingerprint: null };
    expect(captureIdentityVersions(baseline, destination)).toEqual([...baseline, destination]);
    expect(baseline).toHaveLength(1);
  });

  it('adopts prepared CSV credentials while retaining the loaded spec credential', () => {
    const target = entityTargetFixture('weapon', 'demo');
    const csv = 'M:/mod/data/weapons/weapon_data.csv';
    const baseline = [
      { path: target.write.path, fingerprint: 'loaded-spec' },
      { path: csv, fingerprint: 'old-table' },
    ];
    expect(
      handoffTableVersions(baseline, {
        target,
        baseVersions: [
          { path: target.write.path, fingerprint: 'external-spec' },
          { path: csv, fingerprint: 'saved-table' },
        ],
      }),
    ).toEqual([
      { path: target.write.path, fingerprint: 'loaded-spec' },
      { path: csv, fingerprint: 'saved-table' },
    ]);
    expect(baseline[1]!.fingerprint).toBe('old-table');
  });

  it('compares prepared file paths consistently and preserves unrelated credentials', () => {
    const target = entityTargetFixture('weapon', 'demo');
    const primary = { path: target.write.path, fingerprint: 'loaded-spec' };
    const other = { path: 'M:/mod/data/other.json', fingerprint: 'loaded-other' };
    const linked = { path: 'm:/mod/data/weapons/weapon_data.csv', fingerprint: 'saved-table' };
    expect(
      handoffTableVersions([primary, other, { ...linked, path: linked.path.toUpperCase(), fingerprint: 'old-table' }], {
        target,
        baseVersions: [{ path: target.write.path.toUpperCase().replaceAll('/', '\\'), fingerprint: 'external-spec' }, linked],
      }),
    ).toEqual([primary, other, linked]);
    expect(handoffTableVersions([primary, other], { target, baseVersions: [primary] })).toEqual([primary, other]);
  });
});
