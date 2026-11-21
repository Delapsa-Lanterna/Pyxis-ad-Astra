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
function finishBurst(state: FiringState, chargedown: number) {
  state.shot = 0;
  state.phase = 'cooldown';
  state.remaining = chargedown;
}
export function scheduleShots(
  state: FiringState,
  definition: WeaponFirePreviewDefinition,
  dt: number,
  firing: boolean,
  random: () => number,
): ShotEvent[] {
  const events: ShotEvent[] = [];
  if (!firing) {
    if (state.phase === 'burst' && definition.interruptible) finishBurst(state, definition.chargedown);
    if (state.phase === 'chargeup' && !definition.autoCharge) {
      state.phase = 'idle';
      state.remaining = 0;
    }
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
    if (state.phase === 'cooldown') {
      if (!firing) {
        state.phase = 'idle';
        state.remaining = 0;
        break;
      }
      state.phase = 'chargeup';
      state.remaining = definition.chargeup;
      continue;
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
    if (state.shot >= definition.burstSize || (!firing && definition.interruptible)) {
      finishBurst(state, definition.chargedown);
      if (firing && !state.remaining && !definition.chargeup) break;
    } else {
      state.phase = 'burst';
      state.remaining = definition.burstDelay;
    }
  }
  state.spread = Math.max(definition.minSpread, state.spread - (dt - elapsed) * definition.spreadDecay);
  state.remaining = Math.max(0, state.remaining - (dt - elapsed));
  return events;
}
