import type { ErrorDiagnostic } from '@/shared/types/error.types';

export interface GameScanWarning extends ErrorDiagnostic {
  path: string;
  editTarget: GameWarningEditTarget | null;
}

export interface GameWarningEditTarget {
  modRoot: string;
  path: string;
}

export interface GameModSummary {
  modRoot: string;
  id: string;
  name: string;
  version: string;
  description: string;
  hasModInfo: boolean;
}

export interface GameOverviewData {
  starsectorRoot: string;
  coreAvailable: boolean;
  modsDir: string;
  mods: GameModSummary[];
  warnings: GameScanWarning[];
}

export type OpenDirectoryKind = 'game-root' | 'mod-in-game' | 'external-mod' | 'unknown';

export interface OpenDirectoryResult {
  kind: OpenDirectoryKind;
  selectedPath: string;
  starsectorRoot: string | null;
  modRoot: string | null;
  overview: GameOverviewData | null;
  warnings: GameScanWarning[];
}

export interface DetectDirectoryPayload {
  path: string;
  knownStarsectorRoot: string | null;
}

export interface ScanGameOverviewPayload {
  starsectorRoot: string;
}
