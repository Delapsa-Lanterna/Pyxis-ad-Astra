import type { RowData } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';

/// Fields the system editor renders as structured controls; every other key
/// in a `.system` spec is treated as an extra passthrough field.
export const SYSTEM_STRUCTURED_FIELD_KEYS: ReadonlySet<string> = new Set([
  'id',
  'type',
  'aiType',
  'statsScript',
  'aiScript',
  'runScriptWhilePaused',
  'runScriptWhileIdle',
  'blockActionsWhileChargingDown',
  'canNotCauseOverload',
  'canUseWhileRightClickSystemOn',
  'clampTurnRateAfter',
  'clampMaxSpeedAfter',
  'alwaysAccelerate',
  'flameoutOnImpactChance',
  'fadeActivationSoundOnChargedown',
  'activatingShieldsCancels',
  'useSound',
  'loopSound',
  'deactivateSound',
  'outOfUsesSound',
  'soundFilterType',
  'soundFilterGain',
  'soundFilterGainHF',
  'engineGlowColor',
  'engineGlowContrailColor',
  'engineGlowLengthMult',
  'engineGlowWidthMult',
  'engineGlowGlowMult',
  'weaponGlowColor',
  'weaponTypes',
  'jitterColor',
  'jitterCopies',
  'jitterMinRange',
  'jitterRange',
  'jitterRangeRadiusFraction',
  'jitterUnderColor',
  'jitterUnderCopies',
  'jitterUnderMinRange',
  'jitterUnderRange',
  'jitterUnderRangeRadiusFraction',
  'effectColor1',
  'effectColor2',
  'phaseHighlight',
  'phaseDiffuse',
  'shipAlpha',
  'shieldRingColor',
  'shieldInnerColor',
  'shieldThicknessMult',
  'shieldFluctuationMult',
  'range',
  'randomRange',
  'renderCopyDuringTeleport',
  'weaponDataId',
  'droneVariant',
  'allowFreeRoam',
  'launchSpeed',
  'launchDelay',
  'maxDrones',
  'droneBehavior',
  'empDamage',
  'damage',
  'damageType',
  'aiHints',
]);

export function normalizeSystemSpec(system: RowData): RowData {
  const normalized = deepClone(system);
  normalized.type = normalized.type || 'STAT_MOD';
  normalized.droneBehavior = Array.isArray(normalized.droneBehavior) ? normalized.droneBehavior : [];
  normalized.aiHints = normalized.aiHints && typeof normalized.aiHints === 'object' ? normalized.aiHints : {};
  normalized.weaponTypes = Array.isArray(normalized.weaponTypes) ? normalized.weaponTypes : [];
  return normalized;
}
