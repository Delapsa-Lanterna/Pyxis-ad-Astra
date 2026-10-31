import type { DeepReadonly, RowData, ResourceRef } from '@/shared/types';
import { num, str } from '@/shared/lib/starsector';
import { isRowData } from '@/shared/lib/row-data';
import { projectileAppearance } from '@/domain/editors/projectile-appearance';
import { weaponAnglesKey, weaponBarrelOffsetsFor, type WeaponViewMode } from '@/shared/lib/starsector/weapon-sprite-fields';

export type PreviewResources = Readonly<Record<string, ResourceRef>>;
export function createWeaponFirePreviewDefinition(
  csv: DeepReadonly<RowData>,
  weapon: DeepReadonly<RowData>,
  projectile: DeepReadonly<RowData>,
  mode: WeaponViewMode,
  resources: { weapon: PreviewResources; projectile: PreviewResources } = { weapon: {}, projectile: {} },
) {
  const beam = weapon.specClass === 'beam',
    spec = beam ? weapon : projectile;
  const appearance = projectileAppearance(spec),
    engine = isRowData(spec.engineSpec) ? spec.engineSpec : {};
  const offsets = weaponBarrelOffsetsFor(weapon, mode),
    angles = weapon[weaponAnglesKey(mode)];
  const speed = num(csv[beam ? 'beam speed' : 'proj speed'], beam ? 1400 : 0),
    range = num(csv.range, 250),
    missile = appearance.kind === 'missile';
  const spread = mode === 'hardpoint' ? 0.5 : 1;
  return {
    beam,
    appearance,
    resources: beam ? resources.weapon : resources.projectile,
    weaponResources: resources.weapon,
    barrels: Array.from({ length: offsets.length / 2 }, (_, i) => ({
      x: offsets[i * 2]!,
      y: offsets[i * 2 + 1]!,
      angle: Array.isArray(angles) ? num(angles[i]) : 0,
    })),
    barrelMode: str(weapon.barrelMode, 'ALTERNATING'),
    range,
    speed,
    launchSpeed: num(csv['launch speed']),
    flightTime: missile
      ? spec.useProjectileRangeCalculation === true
        ? range / Math.max(1, speed)
        : num(csv['flight time'], 1)
      : speed > 0
        ? range / speed
        : Infinity,
    chargeup: num(csv.chargeup),
    chargedown: num(csv.chargedown),
    burstSize: beam ? num(csv['burst size']) : Math.max(1, Math.trunc(num(csv['burst size'], 1))),
    burstDelay: num(csv['burst delay']),
    minSpread: num(csv['min spread']) * spread,
    maxSpread: num(csv['max spread']) * spread,
    spreadPerShot: num(csv['spread/shot']) * spread,
    spreadDecay: num(csv['spread decay/sec']),
    interruptible: weapon.interruptibleBurst === true,
    autoCharge: weapon.autocharge === true,
    fullChargeOnly: weapon.beamFireOnlyOnFullCharge === true,
    skipIdle: weapon.skipIdleFrameIfZeroBurstDelay === true,
    randomPhase: weapon.randomizeTextureOffset === true,
    acceleration: num(engine.acc),
    deceleration: num(engine.dec),
    missileType: str(spec.missileType),
    fadeTime: num(spec.fadeTime, missile ? 0.5 : 0),
    flameoutTime: num(spec.flameoutTime, 4),
    noGlowTime: num(spec.noEngineGlowTime, 2.5),
    rangeFlameout: spec.fizzleOnReachingWeaponRange === true,
    behavior: isRowData(spec.behaviorSpec) ? spec.behaviorSpec : {},
  };
}
export type WeaponFirePreviewDefinition = ReturnType<typeof createWeaponFirePreviewDefinition>;
