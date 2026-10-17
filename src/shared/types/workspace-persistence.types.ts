import type { CsvTableKey } from '@/shared/types/project-identity.types';
import type { GameModSummary, GameScanWarning } from '@/shared/types/directory-opening.types';

export type WorkspaceColumnWidths = Record<string, Partial<Record<CsvTableKey, Record<string, number>>>>;

/** Persisted mod entry (stored to disk) */
export interface PersistedMod {
  modRoot: string;
  displayName: string;
  version: string;
}

/** Persisted workspace state (stored to disk via Rust backend) */
export interface PersistedWorkspace {
  mods: PersistedMod[];
  starsectorRoot: string | null;
  gameMods: GameModSummary[];
  gameWarnings: GameScanWarning[];
  columnWidths: WorkspaceColumnWidths;
}

export interface SaveWorkspacePayload {
  state: PersistedWorkspace;
}
