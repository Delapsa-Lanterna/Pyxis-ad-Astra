import type { EntityKind } from './project-identity.types';

export type MiscConfigKind =
  'strings' | 'engineStyles' | 'hullStyles' | 'sounds' | 'settings' | 'customEntities' | 'planets' | 'defaultShipRoles';
export interface JsonSourceIdentity {
  kind: Extract<EntityKind, 'faction' | 'mission' | 'variant' | 'skin'>;
  id: string;
  relPath: string | null;
}

export type JsonDocumentOrigin =
  | { kind: 'modInfo' }
  | { kind: 'miscConfig'; file: MiscConfigKind }
  | {
      kind: 'entity';
      target: JsonSourceIdentity;
    };
