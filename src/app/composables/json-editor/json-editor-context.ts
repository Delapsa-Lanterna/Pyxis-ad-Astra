import type { Ref } from 'vue';
import type { ProjectManifest, JsonEditorPageId, WorkspaceEntityLocation } from '@/shared/types';
import type { ConfigDocumentTarget } from '@/domain/json-editor/json-document-definitions';

export interface JsonEditorPageTarget {
  sessionId: string;
  modRoot: string;
  page: JsonEditorPageId;
}
export interface JsonEditorHost {
  pageTarget: Readonly<Ref<JsonEditorPageTarget | null>>;
  entityLocation: Readonly<Ref<Readonly<WorkspaceEntityLocation> | null>>;
  completeEntityLocation: (location: Readonly<WorkspaceEntityLocation>) => void;
  locateBaseHull: (origin: ConfigDocumentTarget, hull: { id: string; rowKey: string }) => void;
}
export interface JsonEditorContext extends Pick<JsonEditorHost, 'entityLocation' | 'completeEntityLocation'> {
  active: Readonly<Ref<boolean>>;
  modRoot: Readonly<Ref<string | null>>;
  sessionId: Readonly<Ref<string | null>>;
  manifest: Readonly<Ref<ProjectManifest | null>>;
}
