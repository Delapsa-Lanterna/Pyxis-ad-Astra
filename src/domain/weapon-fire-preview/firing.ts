import type { WeaponFirePreviewDefinition } from './preview-definition';

export function createFiringState() {
  return { phase: 'idle', remaining: 0, shot: 0, barrel: 0, spread: 0 };
}
export type FiringState = ReturnType<typeof createFiringState>;
export interface ShotEvent {
  time: number;
  barrel: number;
  angle: number;
}
export function scheduleShots(
  state: FiringState,
  definition: WeaponFirePreviewDefinition,
  dt: number,
  firing: boolean,
  random: () => number,
): ShotEvent[] {
  const events: ShotEvent[] = [];
  if (!firing && (!state.shot || definition.interruptible) && !(definition.autoCharge && state.phase === 'chargeup')) {
    state.shot = 0;
    if (state.phase === 'chargeup') state.phase = 'idle';
  }
  if (state.phase === 'idle') {
    if (!firing) {
      state.spread = Math.max(definition.minSpread, state.spread - dt * definition.spreadDecay);
      return events;
    }
    state.remaining = definition.chargeup;
    state.phase = 'chargeup';
  }
  let elapsed = 0;
  while (elapsed + state.remaining <= dt) {
    state.spread = Math.max(definition.minSpread, state.spread - state.remaining * definition.spreadDecay);
    elapsed += state.remaining;
    if (!firing && !state.shot && !definition.autoCharge) {
      state.phase = 'idle';
      state.remaining = 0;
      break;
    }
    const count = definition.barrels.length,
      mode = definition.barrelMode;
    const barrels =
      mode === 'LINKED'
        ? definition.barrels.map((_, i) => i)
        : mode === 'DUAL'
          ? [state.barrel % count, (state.barrel + 1) % count]
          : [state.barrel % count];
    for (const barrel of barrels) {
      const angle = definition.barrels[barrel]!.angle + (random() - 0.5) * Math.max(definition.minSpread, state.spread);
      events.push({ time: elapsed, barrel, angle });
      state.spread = Math.min(definition.maxSpread, Math.max(definition.minSpread, state.spread) + definition.spreadPerShot);
    }
    state.shot++;
    if (mode === 'ALTERNATING' || mode === 'DUAL' || (mode === 'ALTERNATING_BURST' && state.shot === definition.burstSize))
      state.barrel = (state.barrel + barrels.length) % count;
    if (state.shot >= definition.burstSize) {
      state.shot = 0;
      state.phase = 'cooldown';
      state.remaining = definition.chargedown + definition.chargeup;
      if (!state.remaining) break;
    } else {
      state.phase = 'burst';
      state.remaining = definition.burstDelay;
    }
    if (!firing && definition.interruptible) {
      state.shot = 0;
      break;
    }
  }
  state.spread = Math.max(definition.minSpread, state.spread - (dt - elapsed) * definition.spreadDecay);
  state.remaining = Math.max(0, state.remaining - (dt - elapsed));
  return events;
}
