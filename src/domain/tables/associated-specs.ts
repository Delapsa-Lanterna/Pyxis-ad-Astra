import type { SpecEditorKind, CsvTableKey } from '@/shared/types';

interface AssociatedSpecDefinition {
  kind: 'ship' | 'weapon' | 'system' | 'skill';
  editorKinds: SpecEditorKind[];
}

const ASSOCIATED_SPEC_DEFINITIONS: Partial<Record<CsvTableKey, AssociatedSpecDefinition>> = {
  ships: {
    kind: 'ship',
    editorKinds: ['ship'],
  },
  weapons: {
    kind: 'weapon',
    editorKinds: ['weapon'],
  },
  shipSystems: {
    kind: 'system',
    editorKinds: ['system'],
  },
  skills: {
    kind: 'skill',
    editorKinds: [],
  },
};

export function associatedSpecEditorKinds(table: CsvTableKey): SpecEditorKind[] {
  return [...(ASSOCIATED_SPEC_DEFINITIONS[table]?.editorKinds ?? [])];
}
export function associatedSpecKind(table: CsvTableKey) {
  return ASSOCIATED_SPEC_DEFINITIONS[table]?.kind ?? null;
}
