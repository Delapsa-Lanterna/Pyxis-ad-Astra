import { frontendLayerBoundaryRule } from './rules/dependencies/frontend-layer-boundary.mjs';
import { rustProjectLayerBoundaryRule } from './rules/dependencies/rust-project-layer-boundary.mjs';
import { rustServiceEdgeBoundaryRule } from './rules/dependencies/rust-service-edge-boundary.mjs';
import { sharedTypesBoundaryRule } from './rules/dependencies/shared-types-boundary.mjs';
import { capabilityBoundaryRule } from './rules/capabilities/capability-boundary.mjs';
import { commandBoundaryRule } from './rules/capabilities/command-boundary.mjs';
import { rustCommandFunctionsRule } from './rules/capabilities/rust-command-functions.mjs';
import { saveBackendBoundaryRule } from './rules/capabilities/save-backend-boundary.mjs';
import { namingBoundaryRule } from './rules/conventions/naming-boundary.mjs';
import { writableStateCopyCycleRule } from './rules/conventions/writable-state-copy-cycle.mjs';
import { errorBoundaryRule } from './rules/modules/app-feedback/error-boundary.mjs';
import { feedbackBoundaryRule } from './rules/modules/app-feedback/feedback-boundary.mjs';
import { csvDraftBoundaryRule } from './rules/modules/csv-editor/csv-draft-boundary.mjs';
import { csvModuleBoundaryRule } from './rules/modules/csv-editor/csv-module-boundary.mjs';
import { directoryOpeningBoundaryRule } from './rules/modules/directory-opening/directory-opening-boundary.mjs';
import { draftSessionBoundaryRule } from './rules/modules/edit-session/draft-session-boundary.mjs';
import { readTicketBoundaryRule } from './rules/modules/edit-session/read-ticket-boundary.mjs';
import { editorModuleBoundaryRule } from './rules/modules/editors/editor-module-boundary.mjs';
import { editorQueryBoundaryRule } from './rules/modules/editors/editor-query-boundary.mjs';
import { renderingBoundaryRule } from './rules/modules/editors/rendering-boundary.mjs';
import { fileHistoryBoundaryRule } from './rules/modules/file-history/file-history-boundary.mjs';
import { mainHistoryCommandBoundaryRule } from './rules/modules/file-history/main-history-command-boundary.mjs';
import { projectSessionBoundaryRule } from './rules/modules/project-session/project-session-boundary.mjs';
import { projectResourcesBoundaryRule } from './rules/modules/resources/project-resources-boundary.mjs';
import { resourceBoundaryRule } from './rules/modules/resources/resource-boundary.mjs';
import { parserBoundaryRule } from './rules/modules/schema/parser-boundary.mjs';
import { schemaModuleBoundaryRule } from './rules/modules/schema/schema-module-boundary.mjs';
import { workspaceModuleBoundaryRule } from './rules/modules/workspace/workspace-module-boundary.mjs';
import { workspacePersistenceBoundaryRule } from './rules/modules/workspace/workspace-persistence-boundary.mjs';
import { moduleStructureRule } from './rules/documentation/module-structure.mjs';
import { moduleOwnershipRule } from './rules/documentation/module-ownership.mjs';
import { ruleBoundaryRule } from './rules/meta/rule-boundary.mjs';

export const rules = [
  frontendLayerBoundaryRule,
  rustProjectLayerBoundaryRule,
  rustServiceEdgeBoundaryRule,
  sharedTypesBoundaryRule,
  namingBoundaryRule,
  writableStateCopyCycleRule,
  errorBoundaryRule,
  feedbackBoundaryRule,
  csvDraftBoundaryRule,
  csvModuleBoundaryRule,
  directoryOpeningBoundaryRule,
  draftSessionBoundaryRule,
  readTicketBoundaryRule,
  editorModuleBoundaryRule,
  editorQueryBoundaryRule,
  renderingBoundaryRule,
  fileHistoryBoundaryRule,
  mainHistoryCommandBoundaryRule,
  projectSessionBoundaryRule,
  projectResourcesBoundaryRule,
  resourceBoundaryRule,
  parserBoundaryRule,
  schemaModuleBoundaryRule,
  workspaceModuleBoundaryRule,
  workspacePersistenceBoundaryRule,
  capabilityBoundaryRule,
  commandBoundaryRule,
  rustCommandFunctionsRule,
  saveBackendBoundaryRule,
  moduleStructureRule,
  moduleOwnershipRule,
  ruleBoundaryRule,
];
