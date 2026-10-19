export { TABLE_KEYS, RESOURCE_OWNER_KINDS, RESOURCE_SOURCES } from '@/shared/types/project-identity.types';
export type {
  EntityEditTarget,
  EntityEditInfo,
  EntityFileLocation,
  EntityLinkedRecord,
  EntityTargetState,
  EntityIdentityChange,
  EntityIdentityIntent,
  FileVersion,
  CsvTableKey,
  EntityKind,
  ProjectSessionId,
  ResourceOwnerKind,
  ResourceRef,
  ResourceSource,
  EntityIdentityIntentPayload,
} from '@/shared/types/project-identity.types';
export type {
  DraftResourceEntityKind,
  HullReferenceGroup,
  HullReferenceKind,
  HullReferenceOption,
  HullReferencesResult,
  ResourceDataUrlBatchEntry,
  ResourceDataUrlBatchResult,
  DraftResourcesPayload,
  ResourceDataUrlBatchPayload,
  ResolveModRelativePathPayload,
  HullReferencesPayload,
  HullWeaponSlot,
} from '@/shared/types/resources.types';
export type {
  ModFileEntry,
  ModDirectory,
  ModFileKind,
  ModTextFileTarget,
  ModDirectoryState,
  ModFileBrowserState,
  ModFileBranch,
  ModFileSearch,
  ModFileSortKey,
  ModFileSort,
} from '@/shared/types/mod-file-browser.types';
export type {
  DeepReadonly,
  ReadonlyJsonValue,
  ReadonlyJsonArray,
  ReadonlyJsonObject,
  JsonInputShape,
  JsonInputValue,
  JsonValue,
  RowData,
} from '@/shared/types/json.types';
export type { FontId, OriginalFontPage, OriginalFontResult, QueryOriginalFontPayload } from '@/shared/types/font.types';
export type { EditContext } from '@/shared/types/edit-context.types';
export type { SessionQueryIdentity } from '@/shared/types/query-cache.types';
export type { CacheLimits, CacheSize, FontCacheLimits, QueryCacheKey } from '@/shared/types/cache-limits.types';
export { QUERY_CACHE_KEYS } from '@/shared/types/cache-limits.types';
export type { ErrorDiagnostic, ErrorLocation, FeedbackNotice } from '@/shared/types/error.types';

export type {
  WindowIdentity,
  CloseScope,
  ClosePhase,
  CloseResult,
  WindowCloseIntent,
  NativeWindowRequest,
  ManagedWindowStatus,
  ManagedWindowInput,
  ManagedWindowContext,
  WindowContextFor,
  FileWindowLocation,
  WindowBootstrap,
  WindowRequestReceipt,
  WindowRequestResult,
} from '@/shared/types/window.types';
export type { CreatedMod, CreateModRequest, NewModDestination, NewModTemplate } from '@/shared/types/mod-creation.types';
export type {
  AccentPreset,
  AppSettings,
  AppTheme,
  EditMode,
  LogLevel,
  SaveAppSettingsPayload,
  SettingsSnapshot,
} from '@/shared/types/app-settings.types';
export { ACCENT_PRESET_VALUES, APP_THEMES, EDIT_MODES, LOG_LEVELS } from '@/shared/types/app-settings.types';
export type { AppLogEntry, AppLogLevel, AppLogStatus, AppendAppLogPayload } from '@/shared/types/app-log.types';
export { APP_LOG_LEVELS } from '@/shared/types/app-log.types';
export type { FileChangeKind, FileChangeRecord, FileChangeReplayDirection, FileSnapshot } from '@/shared/types/file-changes.types';
export type { CsvDraftOperation, CsvEditHistoryEntry } from '@/shared/types/tables-edit-history.types';
export type {
  FileHistoryEntrySummary,
  FileHistorySnapshot,
  ApplyFileChangeSetPayload,
  FileHistoryPayload,
} from '@/shared/types/file-history.types';
export type {
  AssociatedSpecChange,
  AssociatedSpecWrite,
  AssociatedSpecCreateParams,
  CsvRowPatch,
  CsvRowPatchAction,
  CsvRowOrderEntry,
  SaveCsvPatchPayload,
} from '@/shared/types/table-save.types';
export type {
  CsvRowKeyMapping,
  JsonSourceConfirmation,
  JsonWriteOptions,
  WriteResult,
  CommittedSessionUpdate,
  CommittedProjection,
  CommittedWriteEvent,
  SynchronizeCommittedWritePayload,
} from '@/shared/types/write-commit.types';
export type {
  ConfigFamilyFile,
  ConfigFamilyEntityPayload,
  DeleteConfigFamilyEntityPayload,
  VariantFile,
  SkinFile,
} from '@/shared/types/config-family.types';
export type {
  ConfigSaveIdentity,
  ConfigIdentityHandoff,
  SavedConfig,
  ConfigEditTarget,
  ConfigMissionEditorData,
  IndexedConfigEntityData,
  IndexedConfigEntityRefresh,
  IndexedConfigKind,
  SaveModInfoPayload,
  IndexedConfigEntityPayload,
  DeleteIndexedConfigEntityPayload,
} from '@/shared/types/config-entity.types';
export type {
  CsvDirtyRow,
  CsvDraftRow,
  CsvRow,
  CsvRowRecord,
  CsvCellTarget,
  CsvTableTarget,
  CsvSearchField,
  CsvRowPreview,
  CsvRowPreviewTarget,
  CsvTableRows,
  CsvTableIndex,
  CsvTableIndexPayload,
  CsvTableRowsRead,
  CsvTableRowsPayload,
  CsvRowPreviewPayload,
} from '@/shared/types/tables.types';

export type { DiscoveredField, DiscoveredFieldType, CoreScanPayload, InvalidateCoreCachePayload } from '@/shared/types/core-assets.types';
export type { EntityData, QueryEntityPayload, QueryEntityListPayload } from '@/shared/types/entity-query.types';
export type {
  EntitySummaries,
  InvalidatedEntityRef,
  InvalidatedQueryKind,
  InvalidatedQueryScope,
  InvalidatedResourceScope,
  ProjectInvalidation,
  ProjectManifest,
  ProjectSessionInvalidationResult,
  TableSummary,
  OpenProjectSessionPayload,
  CloseProjectSessionPayload,
  InvalidateProjectSessionPayload,
  RefreshProjectSourcesPayload,
} from '@/shared/types/project-session.types';
export type {
  GameModSummary,
  GameOverviewData,
  GameScanWarning,
  GameWarningEditTarget,
  OpenDirectoryKind,
  OpenDirectoryResult,
  DetectDirectoryPayload,
  ScanGameOverviewPayload,
} from '@/shared/types/directory-opening.types';

export type { SourceOption, SourceOptionGroup, CsvSourceOptionsPayload } from '@/shared/types/schema.types';

export type {
  EditableFileData,
  SaveTextFilePayload,
  TranscodeFilePayload,
  LoadEditableFilePayload,
  TextIdentityIntentPayload,
  FollowTextIdentityPayload,
} from '@/shared/types/file-editor.types';
export { SPEC_EDITOR_KINDS } from '@/shared/types/spec-editor.types';
export type {
  ConfigView,
  ModEntry,
  ModOpeningFailure,
  ModOpeningFailureFile,
  ModTableState,
  WorkspaceView,
} from '@/shared/types/workspace.types';
export type {
  PersistedMod,
  PersistedWorkspace,
  WorkspaceColumnWidths,
  SaveWorkspacePayload,
} from '@/shared/types/workspace-persistence.types';
export type { AppFeedback, ChooseOptions, ConfirmOptions } from '@/shared/types/feedback.types';
export type * from '@/shared/types/joint-edit.types';

export type { WeaponFirePreviewSource, WeaponFirePreviewData } from '@/shared/types/weapon-fire-preview.types';

export type {
  SpecEditorKind,
  WeaponSpecClass,
  ProjectileSpecClass,
  SpecEditorData,
  SpecWeaponEditorData,
  SpecProjectileEditorData,
  LoadImportedEditorSpecPayload,
  SaveEditorSpecPayload,
} from '@/shared/types/spec-editor.types';
