import type { Ref } from 'vue';
import type { CsvTableTarget, ProjectManifest, WorkspaceEntityLocation } from '@/shared/types';
import type { TableDetailAction } from '@/domain/csv-editor/table-detail-actions';
export interface CsvEditorHost {
  target: Readonly<Ref<CsvTableTarget | null>>;
  manifest: Readonly<Ref<ProjectManifest | null>>;
  starsectorRoot: Readonly<Ref<string | null>>;
  columnWidths: Readonly<Ref<Record<string, number>>>;
  entityLocation: Readonly<Ref<Readonly<WorkspaceEntityLocation> | null>>;
  setColumnWidth: (target: CsvTableTarget, column: string, width: number) => void;
  completeEntityLocation: (location: Readonly<WorkspaceEntityLocation>) => void;
  cancelEntityLocation: (location: Readonly<WorkspaceEntityLocation>) => void;
  locateWingReference: (
    origin: Extract<TableDetailAction, { type: 'wing-navigation' }>,
    location: Pick<WorkspaceEntityLocation, 'kind' | 'id' | 'rowKey'>,
  ) => void;
}
