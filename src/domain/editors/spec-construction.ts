import defaults from '../../../schemas/spec-defaults.json';
import type { RowData } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';

export function createShipSpec(id: string, hullName = id): RowData {
  return { ...deepClone(defaults.ship), hullId: id, hullName };
}

export function createSystemSpec(id: string): RowData {
  return { ...deepClone(defaults.system), id };
}

export function createSkillSpec(id: string): RowData {
  return { ...deepClone(defaults.skill), id };
}

export function fillRequiredFields(content: RowData, template: RowData, required: readonly string[]): RowData {
  const next = deepClone(content);
  for (const key of required) if (!(key in next)) next[key] = deepClone(template[key]!);
  return next;
}
