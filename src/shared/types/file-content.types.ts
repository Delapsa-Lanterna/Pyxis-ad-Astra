export type FileText = string | number[];
export type FileValue =
  | { kind: 'null' }
  | { kind: 'bool'; value: boolean }
  | { kind: 'integer'; value: string }
  | { kind: 'float'; value: string }
  | { kind: 'text'; value: FileText }
  | { kind: 'array'; value: FileValue[] }
  | { kind: 'object'; value: [FileText, FileValue][] };

export type FilePath = FileText[];
export type OutputFormat = 'value' | 'integer' | 'float';
export type SaveLayout = 'preserveStructure' | 'expanded';
export interface JsonTarget {
  source: FilePath | null;
  output: OutputFormat;
  children: { kind: 'object'; items: [FileText, JsonTarget][] } | { kind: 'array'; items: JsonTarget[] } | null;
}
export interface FileSpan {
  start: number;
  end: number;
}
export interface OriginalMember {
  key: FileText;
  key_span: FileSpan;
  value: number;
  separator: FileSpan | null;
}
export type OriginalNodeKind =
  | { kind: 'scalar' }
  | { kind: 'object'; value: OriginalMember[] }
  | { kind: 'array'; value: { elements: number[]; separators: FileSpan[] } };
export interface OriginalNode {
  span: FileSpan;
  kind: OriginalNodeKind;
}
export interface JsonFileContent {
  content: FileValue;
  source: string;
  original: { root: number; nodes: OriginalNode[] };
}
export interface JsonFileWrite {
  content: FileValue;
  target: JsonTarget;
  layout: SaveLayout;
}
export interface PreparedFileValue {
  value: FileValue;
  target: JsonTarget;
}
export type DocumentEdit =
  | { kind: 'replace'; path: FilePath; value: PreparedFileValue }
  | { kind: 'arraySplice'; path: FilePath; index: number; delete: number; insert: PreparedFileValue[] }
  | { kind: 'objectSplice'; path: FilePath; index: number; delete: number; insert: [FileText, PreparedFileValue][] }
  | { kind: 'reorder'; path: FilePath; order: number[] };
