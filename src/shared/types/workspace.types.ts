/** Metadata for one imported Mod in the workspace */
export interface ModEntry {
  modRoot: string;
  displayName: string;
  version: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
}

export interface ModOpeningFailureFile {
  path: string;
  line?: number;
  column?: number;
}

export interface ModOpeningFailure {
  modRoot: string;
  message: string;
  diagnostic: import('@/shared/types/error.types').ErrorDiagnostic;
  file: ModOpeningFailureFile | null;
}

/** Which main-content view is shown */
export type WorkspaceView = 'overview' | 'table' | 'settings' | 'mod-overview' | 'file-history' | 'json-editor' | 'about' | 'mod-files';

/** Which JSON document is shown when currentView === 'json-editor' */
export type JsonEditorPageId = 'mod-info' | 'factions' | 'skins' | 'variants' | 'mission';
