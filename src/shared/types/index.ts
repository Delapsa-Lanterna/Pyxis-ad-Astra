export { TABLE_KEYS, RESOURCE_OWNER_KINDS, RESOURCE_SOURCES } from '@/shared/types/project-identity.types';
export type {
  EntityEditTarget,
  EntityTargetSnapshot,
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
  ReferenceSource,
  ReferenceSources,
  EntityIdentityIntentPayload,
} from '@/shared/types/project-identity.types';
export type {
  EngineEffect,
  EngineRenderAssets,
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
  FileEntry,
  FileDirectory,
  FileKind,
  FileTextTarget,
  FileDirectoryState,
  FileBrowserState,
  FileBranch,
  FileSearch,
  FileSortKey,
  FileSort,
} from '@/shared/types/file-browser.types';
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
export type {
  ErrorDiagnostic,
  ErrorLocation,
  FeedbackNotice,
  FeedbackFileTarget,
  FileReference,
  FieldProblem,
} from '@/shared/types/error.types';

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
  WindowsPathCaseMap,
  WindowRequestReceipt,
  ModSaveTarget,
  WindowSaveParticipant,
  WindowSaveItem,
  WindowSaveRequest,
  WindowSaveMessage,
  WindowSaveReply,
} from '@/shared/types/window.types';
export type { CreatedMod, CreateModRequest, NewModDestination, NewModTemplate } from '@/shared/types/mod-creation.types';
export type {
  AccentPreset,
  AppSettings,
  AppTheme,
  EditMode,
  ShowCoreFeedback,
  LogLevel,
  SaveAppSettingsPayload,
  SettingsSnapshot,
  ToastDurations,
} from '@/shared/types/app-settings.types';
export { ACCENT_PRESET_VALUES, APP_THEMES, EDIT_MODES, LOG_LEVELS } from '@/shared/types/app-settings.types';
export type { AppLogEntry, AppLogLevel, AppLogStatus, AppendAppLogsPayload } from '@/shared/types/app-log.types';
export { APP_LOG_LEVELS } from '@/shared/types/app-log.types';
export type { FileChangeKind, FileChangeRecord, FileChangeReplayDirection, FileSnapshot } from '@/shared/types/file-changes.types';
export type { CsvDraftEdit, CsvSingleEdit, CsvTableHistoryEntry } from '@/shared/types/csv-table-history.types';
export type { FileHistoryEntrySummary, FileHistorySnapshot, FileReplay, FileHistoryPayload } from '@/shared/types/file-history.types';
export type {
  AssociatedSpecChange,
  AssociatedSpecWrite,
  AssociatedSpecFile,
  AssociatedSpecPreparation,
  AssociatedSpecResolution,
  AssociatedSpecCreateParams,
  CsvRowPatch,
  CsvRowPatchAction,
  CsvRowOrderEntry,
  CsvSave,
} from '@/shared/types/table-save.types';
export type { JsonSourceConfirmation, JsonWriteOptions } from './json-write.types';
export type { SaveAction, SaveRequest } from '@/shared/types/save-action.types';
export type {
  CsvRowKeyMapping,
  WriteResult,
  WriteContent,
  WriteContentTarget,
  SaveAcceptanceTask,
  SaveEdit,
  CommittedSessionUpdate,
  CommittedWriteEvent,
} from '@/shared/types/write-commit.types';
export type { ProjectSyncDelivery, SourceSyncState } from '@/shared/types/project-sync.types';
export type { JsonEntityFile, JsonFileSave, JsonFileDelete, VariantFile, SkinFile } from '@/shared/types/json-file.types';
export type {
  ConfigEditTarget,
  IndexedConfigEntityRefresh,
  IndexedConfigKind,
  ModInfoSave,
  IndexedConfigSave,
  IndexedConfigDelete,
} from '@/shared/types/config-entity.types';
export type {
  CsvDirtyRow,
  CsvDraftRow,
  CsvRow,
  CsvRowRecord,
  CsvCellTarget,
  CsvModState,
  CsvTableState,
  CsvValidationRequest,
  CsvValidationContext,
  CsvTableTarget,
  CsvSearchField,
  CsvRowPreview,
  CsvRowResources,
  CsvRowPreviewTarget,
  CsvTableRows,
  CsvTableIndex,
  CsvTableIndexPayload,
  CsvTableRowsRead,
  CsvTableRowsPayload,
  CsvRowPreviewPayload,
} from '@/shared/types/tables.types';

export type {
  DiscoveredField,
  DiscoveredFieldType,
  CoreRootPayload,
  CoreScanPayload,
  InvalidateCoreCachePayload,
} from '@/shared/types/core-assets.types';
export type { EntityData, QueryEntityPayload, QueryEntityListPayload } from '@/shared/types/entity-query.types';
export type {
  EntitySummaries,
  InvalidatedEntityRef,
  InvalidatedQueryKind,
  InvalidatedQueryScope,
  InvalidatedResourceScope,
  ProjectInvalidation,
  ProjectManifest,
  SessionContentUpdate,
  TableSummary,
  OpenProjectSessionPayload,
  CloseProjectSessionPayload,
  InvalidateProjectSessionPayload,
  SourceRefresh,
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

export type { SourceOption, SourceOptionGroup, SourceCatalogPayload, ImageSourceOptionsPayload } from '@/shared/types/source-catalog.types';

export type {
  EditableFileData,
  TextSave,
  TextTranscode,
  LoadEditableFilePayload,
  FollowTextIdentityPayload,
} from '@/shared/types/file-editor.types';
export { SPEC_EDITOR_KINDS } from '@/shared/types/spec-editor.types';
export type {
  JsonEditorPageId,
  ModEntry,
  ModOpeningFailure,
  ModOpeningFailureFile,
  WorkspaceView,
  WorkspaceEntityLocation,
} from '@/shared/types/workspace.types';
export type {
  PersistedMod,
  PersistedWorkspace,
  WorkspaceColumnWidths,
  SaveWorkspacePayload,
} from '@/shared/types/workspace-persistence.types';
export type {
  AppFeedback,
  WindowFeedback,
  FeedbackLevel,
  FeedbackContext,
  FeedbackFileAction,
  FeedbackFileActions,
  ChooseOptions,
  ConfirmOptions,
} from '@/shared/types/feedback.types';
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
  SpecSave,
} from '@/shared/types/spec-editor.types';

export type * from '@/shared/types/json-recovery.types';
export type * from '@/shared/types/misc-config.types';
export type { PerformanceBatch, PerformanceMonitorStatus } from './performance-monitor.types';
export type { JsonComposition, JsonSourceLayer } from './json-composition.types';
export type { JavaManagementAction, JavaManagementSnapshot, JavaEnvironment } from './java-analysis.types';
