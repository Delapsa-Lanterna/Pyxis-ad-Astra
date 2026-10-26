import type { RowData } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';
import { specSchema, specSections } from '@/domain/spec-editor/spec-schemas';
import { specFieldIssues } from '@/domain/spec-editor/spec-validation';
const schema = specSchema('spec-system');
export const SYSTEM_SOUND_FIELDS = schema.sections!.find((section) => section.id === 'sound')!.fields.filter((field) => field.source);
export const SYSTEM_AI_HINTS_SCHEMA = schema.sections!.find((section) => section.id === 'aiHints')!.fields[0]!;
export function systemSections(system: RowData) {
  return specSections('spec-system', system);
}
export function systemSpecIssues(system: RowData) {
  return systemSections(system).flatMap((section) =>
    section.fields.flatMap((field) => specFieldIssues(field, system[field.key], field.key, false, system)),
  );
}
export function normalizeSystemSpec(system: RowData): RowData {
  const normalized = deepClone(system);
  normalized.type = normalized.type || 'STAT_MOD';
  normalized.droneBehavior = Array.isArray(normalized.droneBehavior) ? normalized.droneBehavior : [];
  normalized.aiHints = normalized.aiHints && typeof normalized.aiHints === 'object' ? normalized.aiHints : {};
  normalized.weaponTypes = Array.isArray(normalized.weaponTypes) ? normalized.weaponTypes : [];
  return normalized;
}
