import { describe, expect, it } from 'vitest';
import { SYSTEM_TYPES } from '@/domain/editors/lib/game-spec-enums';

describe('system field registries', () => {
  it('offers every type accepted by the game system loader', () => {
    expect(SYSTEM_TYPES).toEqual([
      'WEAPON',
      'ENGINE_MOD',
      'SHIELD_MOD',
      'STAT_MOD',
      'FAST_RELOAD',
      'AMMO_RELOAD',
      'TELEPORTER',
      'PHASE_CLOAK',
      'DISPLACER',
      'DRONE_LAUNCHER',
      'EMP',
    ]);
  });
});
