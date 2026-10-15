import { immersiveNumber } from '../fields';
import type { RowData } from '@/shared/types';
import { schemaStringValue } from '@/domain/schema/schema-values';

export function weaponStatistics(csv: Readonly<RowData>, spec: Readonly<RowData>, projectile: Readonly<RowData>) {
  const n = (key: string, fallback = 0) => immersiveNumber(csv, key, fallback);
  const beam = spec.specClass === 'beam';
  const burst = beam ? n('burst size') : Math.trunc(n('burst size', 1));
  const charge = n('chargeup'),
    down = n('chargedown'),
    delay = n('burst delay');
  const barrels =
    spec.barrelMode === 'LINKED'
      ? Array.isArray(spec.turretOffsets)
        ? spec.turretOffsets.length / 2
        : 0
      : spec.barrelMode === 'DUAL'
        ? 2
        : 1;
  let damage = n('damage/shot');
  const mirv = projectile.missileType === 'MIRV';
  if (mirv) {
    const behavior = projectile.behaviorSpec;
    const params = behavior && typeof behavior === 'object' && !Array.isArray(behavior) ? behavior.params : null;
    if (params && typeof params === 'object' && !Array.isArray(params)) {
      const part = params.damage,
        shots = params.numShots;
      damage = typeof part === 'number' && typeof shots === 'number' ? part * shots : NaN;
    } else damage = NaN;
  }
  const ammo = n('ammo', 2147483647),
    regen = n(Object.hasOwn(csv, 'ammo/sec') ? 'ammo/sec' : 'reload/sec');
  const empSource = n(Object.hasOwn(csv, 'emp') ? 'emp' : 'flux');
  let dps: number, sustained: number, fluxRatio: number, burstDamage: number, cycle: number, emp: number;
  const reload = n('reload size', 1);
  if (beam) {
    const rate = n('damage/second');
    if (burst > 0) {
      const effectiveCharge = spec.beamFireOnlyOnFullCharge ? 0 : charge;
      const damageTime = (effectiveCharge + down) * 0.333 + burst;
      cycle = charge + down + burst + delay;
      burstDamage = rate * damageTime;
      dps = burstDamage / cycle;
      fluxRatio = (n('energy/second') * (charge + burst)) / burstDamage;
      sustained = ammo < 2147483647 && regen > 0 ? burstDamage * regen : dps;
      emp = (empSource * ((charge + down) * 0.333 + burst)) / cycle;
    } else {
      cycle = down;
      burstDamage = -1;
      dps = rate;
      sustained = dps;
      fluxRatio = n('energy/second') / dps;
      emp = empSource;
    }
  } else {
    const shot = damage * barrels;
    cycle = charge + down + (burst <= 1 ? 0 : delay * (burst - 1));
    dps = (shot * (burst <= 1 ? 1 : burst)) / cycle;
    sustained = ammo < 2147483647 && regen > 0 ? damage * regen : dps;
    fluxRatio = (charge * n('energy/second') + n('energy/shot') * burst * barrels) / Math.max(1, shot * burst);
    burstDamage = burst > 1 && burst <= 100 && delay < down ? shot * burst : -1;
    emp = mirv ? 0 : (dps * empSource) / damage;
  }
  return {
    beam,
    burst,
    barrels,
    damage,
    dps,
    sustained,
    fluxRatio,
    fluxPerSecond: dps * fluxRatio,
    sustainedFlux: sustained * fluxRatio,
    burstDamage,
    cycle,
    emp,
    ammo,
    regen,
    reload,
    empSource,
    refire: !beam && spec.interruptibleBurst ? down : charge + down + (burst > 1 && burst <= 100 ? delay * (burst - 1) : 0),
    diagnostics: mirv && !Number.isFinite(damage) ? 'MIRV 静态 damage／numShots 来源未提供，脚本效果无法从数据确定。' : '',
  };
}

export function weaponAccuracy(value: number): string {
  return value <= 0
    ? '完美'
    : value <= 2
      ? '优秀'
      : value <= 5
        ? '良好'
        : value <= 10
          ? '中等'
          : value <= 15
            ? '较差'
            : value <= 20
              ? '很差'
              : '极差';
}
export function weaponTurnRate(value: number): string {
  return value <= 0
    ? '无法转向'
    : value <= 5
      ? '很慢'
      : value <= 15
        ? '慢'
        : value <= 25
          ? '中等'
          : value <= 35
            ? '快'
            : value <= 50
              ? '很快'
              : '优秀';
}
export function weaponMissileSpeed(value: number): string {
  return value <= 125 ? '很慢' : value <= 175 ? '慢' : value <= 225 ? '中等' : value <= 275 ? '快' : '很快';
}
export function weaponMissileTracking(speed: number, projectile: Readonly<RowData>): string {
  if (['BOMB', 'ROCKET', 'NO_AI', 'TORPEDO'].includes(schemaStringValue(projectile.missileType))) return '无';
  const engine = projectile.engineSpec;
  if (!engine || typeof engine !== 'object' || Array.isArray(engine)) return '引擎来源未提供';
  const time = speed / immersiveNumber(engine, 'acc', NaN) + 180 / immersiveNumber(engine, 'turnRate', NaN);
  return Number.isNaN(time)
    ? '引擎来源数值无效'
    : time <= 0
      ? '无'
      : time <= 2
        ? '优秀'
        : time <= 4
          ? '良好'
          : time <= 6
            ? '中等'
            : time <= 8
              ? '较差'
              : '很差';
}
