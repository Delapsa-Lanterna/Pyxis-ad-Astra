export const FIELD_TYPES = [
  'string',
  'text',
  'integer',
  'float',
  'boolean',
  'enum',
  'color-rgb',
  'color-rgba',
  'path-image',
  'path',
  'string-array',
  'tag-select',
  'object',
  'array',
  'json',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type SchemaFieldUpdate = { kind: 'set'; value: unknown } | { kind: 'remove' };

export const FIELD_TYPE_SET: ReadonlySet<string> = new Set(FIELD_TYPES);
export type SchemaVisibility = Record<string, string[] | { gt: number }> | Record<string, string[] | { gt: number }>[];

export interface FieldSchema {
  ref?: string;
  visibleWhen?: SchemaVisibility;
  issueCode?: string;
  issueMessage?: string;
  identity?: boolean;
  key: string;
  type: FieldType;
  label: string;
  description?: string;
  required?: boolean;
  editable?: boolean;
  allowExtraFields?: boolean;
  partial?: boolean;
  default?: unknown;
  warning?: string;
  danger?: string;
  source?: string;
  pathBase?: 'mod' | 'mission';
  imageDirectories?: string[];
  min?: number;
  max?: number;
  minEntries?: number;
  maxEntries?: number;
  exclusiveKeys?: string[];
  requiredWhen?: Record<string, string | { min: number } | { missing: true }>;
  step?: number;
  options?: string[];
  nested?: FieldSchema[];
  item?: FieldSchema;
  valueSchema?: FieldSchema;
  keySchema?: FieldSchema;
  variants?: FieldSchema[];
  numberFormat?: 'starsector';
  reservedKeys?: string[];
  presentation?: 'groups';
  operations?: { add?: boolean; remove?: boolean; rename?: boolean };
  /** Underlying key-value storage format: 'array-of-entries' means [{k:v}, ...] arrays */
  format?: 'array-of-entries';
}

export interface SectionSchema {
  visibleWhen?: SchemaVisibility;
  id: string;
  label: string;
  collapsed?: boolean;
  fields: FieldSchema[];
}

export const SCHEMA_SOURCE_TYPES = ['csv-row', 'json-file', 'text-file'] as const;

export type SchemaSourceType = (typeof SCHEMA_SOURCE_TYPES)[number];

export const SCHEMA_SOURCE_TYPE_SET: ReadonlySet<string> = new Set(SCHEMA_SOURCE_TYPES);

export interface SchemaSource {
  id: string;
  type: SchemaSourceType;
  path: string;
  keyField?: string;
  extraFields?: boolean;
}

export interface FileSchema {
  definitions?: Record<string, FieldSchema>;
  $schema?: string;
  id: string;
  allowExtraFields?: boolean;
  fileType?: string;
  displayName?: string;
  description?: string;
  targetFile?: string;
  gameVersion?: string;
  sources?: SchemaSource[];
  sections?: SectionSchema[];
  root?: FieldSchema;
}

export const CSV_COLUMN_CONTROLS = ['text', 'number', 'boolean', 'enum', 'reference', 'tags', 'multi', 'path-image', 'color'] as const;

export type CsvColumnControl = (typeof CSV_COLUMN_CONTROLS)[number];

export const CSV_COLUMN_CONTROL_SET: ReadonlySet<string> = new Set(CSV_COLUMN_CONTROLS);

export interface CsvColumnSchema {
  key: string;
  label?: string;
  control: CsvColumnControl;
  imageDirectories?: string[];
  source?: string;
  options?: string[];
  default?: string;
  readonly?: boolean;
  min?: number;
  max?: number;
  step?: number;
  priority?: number;
}

export type { DiscoveredField } from '@/shared/types';
