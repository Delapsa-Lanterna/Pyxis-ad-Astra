export type ModFileKind = 'directory' | 'file' | 'restricted';
export interface ModFileEntry {
  name: string;
  relPath: string;
  kind: ModFileKind;
  sizeBytes: number | null;
  modifiedAt: number | null;
}
export interface ModDirectory {
  directory: string | null;
  entries: ModFileEntry[];
}
export interface ModTextFileTarget {
  sessionId: string;
  modRoot: string;
  path: string;
}
export interface ModDirectoryState {
  entries: ModFileEntry[] | null;
  loading: boolean;
  error: string;
}
export interface ModFileBranch {
  expanded: string[];
  selected: string | null;
  scrollTop: number;
}
export interface ModFileSearch {
  query: string;
  entries: ModFileEntry[];
  matchedPaths: string[];
}
export type ModFileSortKey = 'name' | 'type' | 'size' | 'modified';
export interface ModFileSort {
  key: ModFileSortKey;
  ascending: boolean;
}
export interface ModFileBrowserState extends ModFileBranch {
  modRoot: string;
  directories: Map<string | null, ModDirectoryState>;
  sort: ModFileSort;
  search: ModFileBranch & { text: string; result: ModFileSearch | null; loading: boolean; error: string };
}
