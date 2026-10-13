import { describe, expect, it } from 'vitest';
import type { ResourceRef, RowData } from '@/shared/types';
import { mountedWeaponImages, weaponImageLayers, weaponLoadedMissile } from './weapon-images';

const resource = (key: string): ResourceRef => ({
  key,
  source: 'mod',
  relPath: 'graphics/' + key + '.png',
  ownerKind: 'weapon',
  ownerId: 'w',
});
const resources = Object.fromEntries(
  ['turretUnderSprite', 'turretSprite', 'turretGunSprite', 'hardpointSprite', 'sprite'].map((key) => [key, resource(key)]),
);
const spec: RowData = {
  specClass: 'projectile',
  size: 'MEDIUM',
  type: 'MISSILE',
  visualRecoil: 1,
  turretOffsets: [10, 2, 20, 4, 30, 6],
  turretAngleOffsets: [15, 30, 45],
  hardpointOffsets: [1, 2, 3, 4],
  hardpointAngleOffsets: [0, 10],
  renderHints: ['RENDER_LOADED_MISSILES', 'RENDER_ADDITIVE'],
};
const projectile = { size: [12, 24], center: [6, 8] };

describe('shared static weapon projections', () => {
  it('tags the independent under pass and orders the body and recoil barrel', () => {
    expect(weaponImageLayers(spec, resources, 'turret').map((layer) => [layer.resource.key, layer.phase])).toEqual([
      ['turretUnderSprite', 'under'],
      ['turretSprite', 'body'],
      ['turretGunSprite', 'body'],
    ]);
    expect(
      weaponImageLayers({ ...spec, renderHints: ['RENDER_BARREL_BELOW'] }, resources, 'turret').map((layer) => layer.resource.key),
    ).toEqual(['turretUnderSprite', 'turretGunSprite', 'turretSprite']);
    expect(weaponImageLayers({ ...spec, visualRecoil: 0 }, resources, 'turret').map((layer) => layer.resource.key)).toEqual([
      'turretUnderSprite',
      'turretSprite',
    ]);
  });
  it('selects the formal mount origin and additive blend', () => {
    const image = mountedWeaponImages(spec, resources, projectile, resources, { id: 'H', mount: 'HARDPOINT', locations: [0, 0] }, []);
    expect(image.layers).toEqual([{ resource: resources.hardpointSprite, origin: { x: 0.5, y: 0.75 }, phase: 'body' }]);
    expect(image.additive).toBe(true);
    expect(image.loadedMissile?.offsets).toEqual([1, 2, 3, 4]);
  });
  it('keeps unconditional loaded missiles on HIDDEN with half turret offsets and hardpoint count', () => {
    const hidden = mountedWeaponImages(spec, resources, projectile, resources, { id: 'X', mount: 'HIDDEN', locations: [0, 0] }, []);
    expect(hidden.layers).toEqual([]);
    expect(hidden.loadedMissile).toMatchObject({ offsets: [5, 1, 10, 2], angles: [15, 30, 45], size: [12, 24], center: [6, 8] });
    expect(
      mountedWeaponImages(
        { ...spec, renderHints: ['RENDER_LOADED_MISSILES_UNLESS_HIDDEN'] },
        resources,
        projectile,
        resources,
        { mount: 'HIDDEN' },
        [],
      ).loadedMissile,
    ).toBeNull();
  });
  it('preserves the missing projectile projection for diagnostics', () => {
    expect(weaponLoadedMissile(spec, {}, {}, 'turret')).toBeNull();
    expect(weaponLoadedMissile({ ...spec, specClass: 'beam' }, projectile, resources, 'turret')).toBeNull();
  });
});
