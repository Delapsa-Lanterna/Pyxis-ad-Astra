import type {
  TableKey,
  EntityKind,
  ResourceRef,
  EntityEditInfo,
  EntityEditTarget,
  EntityIdentityIntent,
} from '@/shared/types/project-identity.types';
import type { CsvSearchField, CsvTableWindow, CsvRowPreview } from '@/shared/types/tables.types';
import type { EntityData, HullReferencesResult, SourceOptionGroup } from '@/shared/types/query.types';
import type { EditorResourceKind } from '@/shared/types/editor.types';
import type { RowData, JsonValue } from '@/shared/types/json.types';

export type ReadonlyJsonValue = null | boolean | number | string | ReadonlyJsonArray | ReadonlyJsonObject;
export type ReadonlyJsonArray = readonly ReadonlyJsonValue[];
export interface ReadonlyJsonObject {
  readonly [key: string]: ReadonlyJsonValue;
}
export type DeepReadonly<T> = [JsonValue] extends [T]
  ? ReadonlyJsonValue
  : T extends object
    ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
    : T;

export interface QueryParameters {
  'joint-edit-catalog': import('./joint-edit.types').JointEditQuery;
  'joint-edit-candidate': import('./joint-edit.types').JointEditQuery;
  'joint-edit': import('./joint-edit.types').JointEditQuery;
  'joint-edit-projection': import('./joint-edit.types').JointEditQuery;
  'joint-edit-prepare': import('./joint-edit.types').JointEditDraft;
  'csv-table-window': { table: TableKey; start: number; count: number; search: string | null; searchField: CsvSearchField };
  'csv-source-options': { source: string };
  'csv-row-preview': { table: TableKey; rowKey: string };
  'hull-references': { referenceIds: string[] };
  'entity-detail': { kind: EntityKind; id: string };
  'entity-list': { kind: EntityKind };
  'entity-edit-target': { kind: EntityKind; id: string };
  'entity-identity-intent': { source: EntityEditTarget; nextId: string };
  'editor-draft-resources': { kind: EditorResourceKind; id: string; draft: RowData };
  'resource-reference': { modRoot: string; absolutePath: string };
}

export interface QueryResults {
  'joint-edit-catalog': import('./joint-edit.types').JointVariantCatalogRead;
  'joint-edit-candidate': import('./joint-edit.types').JointEditSnapshot;
  'joint-edit': import('./joint-edit.types').JointEditSnapshot;
  'joint-edit-projection': import('./joint-edit.types').JointEditSnapshot;
  'joint-edit-prepare': import('./joint-edit.types').JointEditPrepared;
  'csv-table-window': CsvTableWindow;
  'csv-source-options': SourceOptionGroup[];
  'csv-row-preview': CsvRowPreview;
  'hull-references': HullReferencesResult;
  'entity-detail': EntityData | null;
  'entity-list': EntityData[];
  'entity-edit-target': EntityEditInfo;
  'entity-identity-intent': EntityIdentityIntent;
  'editor-draft-resources': Record<string, ResourceRef>;
  'resource-reference': string;
}

export type QueryKind = keyof QueryParameters;
export type QueryCacheKind = Exclude<
  QueryKind,
  | 'entity-edit-target'
  | 'entity-identity-intent'
  | 'editor-draft-resources'
  | 'resource-reference'
  | 'joint-edit'
  | 'joint-edit-prepare'
  | 'joint-edit-projection'
>;
export type QueryIdentity<K extends QueryKind = QueryKind> = K extends QueryKind
  ? { sessionId: string; queryKind: K; parameters: QueryParameters[K] }
  : never;
export type QueryValue<K extends QueryKind> = DeepReadonly<QueryResults[K]>;
