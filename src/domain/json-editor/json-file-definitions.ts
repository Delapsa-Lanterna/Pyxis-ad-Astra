import type { JsonEntityFile } from '@/shared/types';

export interface JsonFileDefinition {
  companionField: string;
  listIconPaths: string[];
  usesHullNames: boolean;
  immersiveKind?: 'variant' | 'skin';
}

export type { JsonEntityFile } from '@/shared/types';

export function jsonFileCompanion(definition: JsonFileDefinition, file: Pick<JsonEntityFile, 'data'>): string {
  return trimmedString(file.data[definition.companionField]);
}

export function jsonFileTitle(
  definition: JsonFileDefinition,
  file: Pick<JsonEntityFile, 'id' | 'data'>,
  hullNames: Record<string, string>,
): string {
  if (!definition.usesHullNames) return trimmedString(file.data.hullName) || file.id;
  const hullId = jsonFileCompanion(definition, file);
  const hullName = hullNames[hullId]?.trim() || hullId;
  const displayName = trimmedString(file.data.displayName);
  return displayName ? `${hullName} (${displayName})` : hullName;
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const variantFileDefinition: JsonFileDefinition = {
  immersiveKind: 'variant',
  companionField: 'hullId',
  listIconPaths: ['M12 3 5 18l7 3 7-3-7-15z', 'M12 3v18M7 15l5 2 5-2'],
  usesHullNames: true,
};

export const skinFileDefinition: JsonFileDefinition = {
  immersiveKind: 'skin',
  companionField: 'baseHullId',
  listIconPaths: ['M12 3 5 18l7 3 7-3-7-15z', 'M8 16h8M9 12h6'],
  usesHullNames: false,
};
