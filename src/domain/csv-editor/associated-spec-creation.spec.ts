import { describe, expect, it } from 'vitest';
import { associatedSpecCreateParams } from './associated-spec-creation';

describe('CSV spec creation parameters', () => {
  it('projects only the creation parameters owned by the format', () => {
    expect(associatedSpecCreateParams('ships', 's', { name: '  Ship  ' })).toEqual({ kind: 'ship', id: 's', hullName: '  Ship  ' });
    expect(associatedSpecCreateParams('ships', 's', { name: 'Ship', _rowKey: 'business', damage: '1' })).toEqual({
      kind: 'ship',
      id: 's',
      hullName: 'Ship',
    });
    expect(associatedSpecCreateParams('weapons', 'w', { type: 'KINETIC', 'beam speed': '10' })).toEqual({
      kind: 'weapon',
      id: 'w',
      specClass: 'beam',
    });
    expect(associatedSpecCreateParams('shipSystems', 's', { name: 'System' })).toEqual({ kind: 'system', id: 's' });
    expect(associatedSpecCreateParams('skills', 's', { name: 'Skill' })).toEqual({ kind: 'skill', id: 's' });
  });
});
