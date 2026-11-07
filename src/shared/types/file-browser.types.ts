export type FileKind = 'directory' | 'file' | 'restricted';
export interface FileEntry {
  name: string;
  relPath: string;
  kind: FileKind;
  sizeBytes: number | null;
  modifiedAt: number | null;
}
export interface FileDirectory {
  directory: string | null;
  entries: FileEntry[];
}
export interface FileTextTarget {
  sessionId: string;
  modRoot: string;
  path: string;
}
export interface FileDirectoryState {
  entries: FileEntry[] | null;
  loading: boolean;
  error: string;
}
export interface FileBranch {
  expanded: string[];
  selected: string | null;
  scrollTop: number;
}
export interface FileSearch {
  query: string;
  entries: FileEntry[];
  matchedPaths: string[];
}
export type FileSortKey = 'name' | 'type' | 'size' | 'modified';
export interface FileSort {
  key: FileSortKey;
  ascending: boolean;
}
export interface FileBrowserState extends FileBranch {
  root: string;
  directories: Map<string | null, FileDirectoryState>;
  sort: FileSort;
  search: FileBranch & { text: string; result: FileSearch | null; loading: boolean; error: string };
}
