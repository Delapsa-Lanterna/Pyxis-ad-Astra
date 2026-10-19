import { classifyFrontendPath } from './classify.mjs';
import { dependencyOrigins } from './imports.mjs';

/** @typedef {import('./classify.mjs').FrontendPathClass} PathRole */
/** @typedef {{ path?: string, layer: string, domain?: string, role?: string }} Owner */
/** @typedef {{ path?: string, layer?: string, role: string, domain: string, names: string[], capability: string, owners: Owner[] }} CapabilityRule */

/** @type {Owner[]} */
const readOwners = [{ layer: 'services' }, { layer: 'orchestrators' }, { layer: 'app', role: 'composable' }];
/** @type {CapabilityRule[]} */
export const frontendCapabilities = [
  {
    role: 'orchestrator',
    domain: 'project-sync',
    names: ['pauseProjectDisplay'],
    capability: 'close-display',
    owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
  },
  {
    role: 'orchestrator',
    domain: 'settings-persistence',
    names: ['initializeSettings'],
    capability: 'settings-start',
    owners: [{ path: 'src/main.ts', layer: 'app' }],
  },
  {
    role: 'orchestrator',
    domain: 'settings-persistence',
    names: ['withSettingsReset'],
    capability: 'settings-reset',
    owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
  },
  ...[
    { domain: 'entity-query', name: 'hasEntityInvalidation' },
    { domain: 'source-options', name: 'hasSourceInvalidation' },
    { domain: 'csv-table', name: 'hasTableInvalidation' },
  ].map(({ domain, name }) => ({ role: 'service', domain, names: [name], capability: 'cache-observe', owners: readOwners })),
  {
    role: 'service',
    domain: 'resource-budget',
    names: ['mediaBudgetLimit', 'mediaBudgetBytes', 'registerMediaBudgetEntry', 'removeMediaBudgetEntry', 'touchMediaBudgetEntry'],
    capability: 'resource-budget',
    owners: ['resource-cache', 'resource-media'].map((domain) => ({ layer: 'services', domain })),
  },
  {
    role: 'service',
    domain: 'mod-file-browser',
    names: ['queryModDirectory', 'queryModFileSearch', 'queryModTextFileTarget'],
    capability: 'mod-file-browser-read',
    owners: [{ layer: 'app', role: 'composable', domain: 'mod-file-browser-view-model' }],
  },
  {
    role: 'service',
    domain: 'font',
    names: ['queryOriginalFont'],
    capability: 'original-font-read',
    owners: [{ layer: 'app', role: 'composable', domain: 'original-fonts' }],
  },
  {
    role: 'service',
    domain: 'weapon-data',
    names: ['queryWeaponData', 'queryWeaponSpecData', 'queryWeaponSprites'],
    capability: 'weapon-data-read',
    owners: [
      { layer: 'services', domain: 'spec-weapon-editor' },
      { layer: 'services', domain: 'weapon-fire-preview' },
    ],
  },
  {
    role: 'service',
    domain: 'spec-weapon-editor',
    names: ['querySpecWeaponEditorData'],
    capability: 'weapon-editor-read',
    owners: [{ layer: 'app', role: 'composable', domain: 'spec-editor-assembly' }],
  },
  {
    role: 'service',
    domain: 'spec-weapon-editor',
    names: ['querySpecWeaponEditorImages', 'querySpecWeaponProjectileOptions'],
    capability: 'spec-weapon-editor-dependencies',
    owners: [{ layer: 'app', role: 'composable', domain: 'spec-weapon-editor-dependencies' }],
  },
  {
    role: 'service',
    domain: 'spec-projectile-editor',
    names: ['querySpecProjectileEditorData', 'querySpecProjectileEditorImages'],
    capability: 'projectile-editor-read',
    owners: [{ layer: 'app', role: 'composable', domain: 'spec-editor-assembly' }],
  },
  {
    role: 'service',
    domain: 'weapon-fire-preview',
    names: ['queryWeaponFirePreviewData', 'queryWeaponFirePreviewImages'],
    capability: 'weapon-fire-preview-read',
    owners: [{ layer: 'app', role: 'composable', domain: 'weapon-fire-preview-window-view-model' }],
  },
  {
    role: 'service',
    domain: 'joint-edit',
    names: ['queryJointEdit', 'queryJointEditRow', 'queryJointEditProjection', 'queryJointVariantCatalog', 'prepareJointEdit'],
    capability: 'joint-edit-read',
    owners: [
      { layer: 'orchestrators', domain: 'joint-edit' },
      { layer: 'app', role: 'composable', domain: 'joint-edit-session' },
      { layer: 'app', role: 'composable', domain: 'immersive-editor-runtime' },
      { layer: 'app', role: 'composable', domain: 'immersive-variant-editor' },
      { layer: 'app', role: 'composable', domain: 'immersive-wing-editor' },
      { layer: 'app', role: 'composable', domain: 'variant-catalog' },
      { layer: 'app', role: 'composable', domain: 'variant-candidate' },
    ],
  },
  {
    role: 'service',
    domain: 'joint-edit',
    names: ['queryJointCandidate'],
    capability: 'joint-candidate-read',
    owners: [
      { layer: 'orchestrators', domain: 'joint-edit' },
      { layer: 'app', role: 'composable', domain: 'joint-edit-session' },
      { layer: 'app', role: 'composable', domain: 'variant-catalog' },
      { layer: 'app', role: 'composable', domain: 'variant-candidate' },
      { layer: 'services', domain: 'spec-ship-editor' },
    ],
  },
  {
    role: 'service',
    domain: 'joint-edit',
    names: ['saveJointEdit'],
    capability: 'joint-edit-write',
    owners: [{ layer: 'orchestrators', domain: 'joint-edit' }],
  },
  {
    role: 'service',
    domain: 'window',
    names: ['updateEditTargetRegistration'],
    capability: 'edit-target-registration',
    owners: [{ layer: 'app', role: 'composable', domain: 'edit-target-handoff' }],
  },
  {
    role: 'service',
    domain: 'window',
    names: ['queryEditTargetOwners', 'reserveEditTargets', 'focusEditTargetOwner'],
    capability: 'edit-target-coordination',
    owners: [{ layer: 'orchestrators', domain: 'edit-target-handoff' }],
  },

  {
    path: 'src/shared/runtime/command.runtime.ts',
    layer: 'shared',
    role: 'shared',
    domain: 'runtime',
    names: ['invokeCommand'],
    capability: 'command-transport',
    owners: [{ layer: 'services' }],
  },
  {
    role: 'service',
    domain: 'app-settings',
    names: ['readSettings'],
    capability: 'settings-read',
    owners: [{ layer: 'orchestrators', domain: 'settings-persistence' }],
  },
  {
    role: 'service',
    domain: 'app-settings',
    names: ['querySystemFonts'],
    capability: 'system-fonts-read',
    owners: [{ path: 'src/app/composables/settings/use-settings-view-model.ts', layer: 'app' }],
  },
  {
    role: 'service',
    domain: 'app-settings',
    names: ['saveSettings'],
    capability: 'settings-write',
    owners: [{ layer: 'orchestrators', domain: 'settings-persistence' }],
  },
  {
    role: 'service',
    domain: 'app-log',
    names: ['recordLogBestEffort'],
    capability: 'log-record',
    owners: readOwners.concat([
      { layer: 'app', domain: 'app-feedback' },
      { path: 'src/main.ts', layer: 'app' },
    ]),
  },
  {
    role: 'service',
    domain: 'app-log',
    names: ['startPerformanceLogSink'],
    capability: 'log-lifecycle',
    owners: [{ path: 'src/main.ts', layer: 'app' }],
  },
  {
    role: 'service',
    domain: 'app-log',
    names: ['loadLogStatus', 'openLogFile', 'clearLog'],
    capability: 'log-maintenance',
    owners: [{ layer: 'app', role: 'composable', domain: 'settings-view-model' }],
  },
  {
    role: 'service',
    domain: 'app-config',
    names: ['openConfigFolder'],
    capability: 'config-maintenance',
    owners: [{ layer: 'app', role: 'composable', domain: 'app-config-actions' }],
  },
  {
    role: 'service',
    domain: 'app-config',
    names: ['clearConfig'],
    capability: 'config-clear',
    owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
  },
  {
    role: 'service',
    domain: 'workspace-state',
    names: ['loadPersistedWorkspace', 'savePersistedWorkspace'],
    capability: 'workspace-persistence',
    owners: [{ layer: 'orchestrators', domain: 'workspace-persistence' }],
  },
  {
    role: 'service',
    domain: 'mod-creation',
    names: ['createNewModProject'],
    capability: 'mod-create',
    owners: [{ layer: 'orchestrators', domain: 'mod-creation' }],
  },
  {
    role: 'service',
    domain: 'core-assets',
    names: ['queryCoreFields', 'queryCoreGraphics'],
    capability: 'core-index-read',
    owners: [{ layer: 'orchestrators', domain: 'core-assets' }],
  },
  {
    role: 'service',
    domain: 'project-projection',
    names: ['markProjectionPending'],
    capability: 'projection-state',
    owners: [{ layer: 'orchestrators', domain: 'project-sync' }],
  },
  {
    role: 'service',
    domain: 'project-projection',
    names: ['markProjectionReady'],
    capability: 'projection-state',
    owners: [
      { layer: 'orchestrators', domain: 'project-sync' },
      { layer: 'orchestrators', domain: 'workspace-lifecycle' },
    ],
  },
  {
    role: 'service',
    domain: 'project-projection',
    names: ['requireProjectionReady'],
    capability: 'projection-read',
    owners: ['query-cache', 'resource-cache', 'resource-media'].map((domain) => ({ layer: 'services', domain })),
  },
  {
    role: 'orchestrator',
    domain: 'project-sync',
    names: ['publishCommittedWrite'],
    capability: 'commit-synchronize',
    owners: ['file-history-replay', 'editor-window', 'file-editor-window'].map((domain) => ({
      layer: 'orchestrators',
      domain,
    })),
  },
  {
    role: 'orchestrator',
    domain: 'project-sync',
    names: ['retryPendingModSyncs'],
    capability: 'commit-retry',
    owners: [
      { layer: 'orchestrators', domain: 'table-save' },
      { layer: 'orchestrators', domain: 'config-save' },
      { layer: 'orchestrators', domain: 'file-history-replay' },
      { layer: 'orchestrators', domain: 'workspace-lifecycle' },
      { layer: 'app', role: 'composable', domain: 'workspace-shell-actions' },
      { layer: 'app', role: 'composable', domain: 'table-save-participants' },
      { layer: 'app', role: 'composable', domain: 'config-list-selection' },
    ],
  },
  {
    role: 'orchestrator',
    domain: 'project-sync',
    names: ['refreshProjectSourcePaths'],
    capability: 'source-refresh',
    owners: [{ layer: 'app', role: 'composable' }],
  },
  {
    role: 'orchestrator',
    domain: 'project-sync',
    names: ['retryPendingSessionSyncs'],
    capability: 'commit-retry',
    owners: [{ layer: 'app', role: 'composable', domain: 'write-sync-view-model' }],
  },
  {
    role: 'orchestrator',
    domain: 'project-sync',
    names: ['invalidateProjectionCaches'],
    capability: 'commit-observe',
    owners: [{ layer: 'orchestrators' }, { layer: 'app', role: 'composable' }],
  },
  {
    role: 'orchestrator',
    domain: 'project-sync',
    names: ['listenCommittedWrites'],
    capability: 'commit-observe',
    owners: [{ layer: 'orchestrators' }, { layer: 'app', role: 'composable' }],
  },
  {
    role: 'orchestrator',
    domain: 'project-sync',
    names: ['listenProjectSessionInvalidated', 'listenEntityIdentityApplied'],
    capability: 'commit-observe',
    owners: [{ layer: 'orchestrators' }, { layer: 'app', role: 'composable' }],
  },

  {
    role: 'orchestrator',
    domain: 'project-sync',
    names: ['completeSavedWrite'],
    capability: 'commit-complete',
    owners: [
      { layer: 'orchestrators', domain: 'config-save' },
      { layer: 'orchestrators', domain: 'table-save' },
      { layer: 'app', role: 'composable', domain: 'joint-edit-session' },
    ],
  },

  {
    role: 'service',
    domain: 'window',
    names: ['focusNativeManagedWindow'],
    capability: 'window-target-focus',
    owners: [
      { layer: 'orchestrators', domain: 'window-target-focus' },
      { layer: 'orchestrators', domain: 'immersive-editor' },
    ],
  },
  {
    role: 'service',
    domain: 'window',
    names: ['requestNativeWindow'],
    capability: 'window-open',
    owners: [{ layer: 'windows', domain: 'managed' }],
  },
  {
    role: 'service',
    domain: 'window',
    names: [
      'getNativeWindowBootstrap',
      'getNativeWindowContext',
      'getNativeWindowRequest',
      'acceptNativeWindowRequest',
      'failNativeWindowRequest',
      'failNativeWindowStartup',
    ],
    capability: 'window-context',
    owners: [{ layer: 'windows', domain: 'window-context' }],
  },
  {
    role: 'service',
    domain: 'window',
    names: ['updateNativeWindowStatus'],
    capability: 'window-lifecycle-guard',
    owners: [{ layer: 'app', role: 'composable', domain: 'dirty-window-close-guard' }],
  },
  {
    role: 'service',
    domain: 'app-lifecycle',
    names: ['requestClose'],
    capability: 'scope-close',
    owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
  },
  {
    role: 'service',
    domain: 'app-lifecycle',
    names: ['replyNativeClose', 'readyNativeClose'],
    capability: 'close-participant',
    owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
  },
  {
    role: 'service',
    domain: 'window',
    names: ['reserveNativeWindowTargets', 'releaseNativeWindowTargets'],
    capability: 'entity-window-identity',
    owners: [
      { layer: 'orchestrators', domain: 'edit-target-handoff' },
      { layer: 'orchestrators', domain: 'entity-identity' },
      { layer: 'orchestrators', domain: 'table-save' },
      { layer: 'orchestrators', domain: 'config-save' },
    ],
  },
  {
    role: 'service',
    domain: 'window',
    names: ['retargetNativeWindow'],
    capability: 'window-identity-handoff',
    owners: [
      { layer: 'orchestrators', domain: 'entity-identity' },
      { layer: 'orchestrators', domain: 'immersive-editor' },
      { layer: 'orchestrators', domain: 'weapon-fire-preview' },
    ],
  },
  {
    layer: 'app',
    role: 'module',
    domain: 'app-feedback',
    names: ['createAppFeedback'],
    capability: 'feedback-factory',
    owners: [{ path: 'src/app/app-feedback-assembly.ts', layer: 'app' }],
  },
  {
    path: 'src/app/app-feedback-assembly.ts',
    layer: 'app',
    role: 'module',
    domain: 'app-feedback-assembly',
    names: ['createWindowFeedback'],
    capability: 'window-feedback-assembly',
    owners: [{ path: 'src/app/WindowRuntime.vue', layer: 'app' }],
  },
  {
    path: 'src/app/composables/use-app-feedback.ts',
    layer: 'app',
    role: 'composable',
    domain: 'app-feedback',
    names: ['provideAppFeedback'],
    capability: 'window-feedback-provider',
    owners: [{ path: 'src/app/WindowRuntime.vue', layer: 'app' }],
  },
  {
    path: 'src/app/composables/use-app-feedback.ts',
    layer: 'app',
    role: 'composable',
    domain: 'app-feedback',
    names: ['useAppFeedback'],
    capability: 'window-feedback-consume',
    owners: [
      { layer: 'app', role: 'composable' },
      { layer: 'app', role: 'component' },
    ],
  },
  {
    path: 'src/app/composables/use-window-close-state.ts',
    layer: 'app',
    role: 'composable',
    domain: 'window-close-state',
    names: ['provideWindowCloseState'],
    capability: 'window-close-provider',
    owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
  },
  {
    path: 'src/app/composables/use-window-close-state.ts',
    layer: 'app',
    role: 'composable',
    domain: 'window-close-state',
    names: ['useWindowCloseState', 'useWindowLifecycleActions'],
    capability: 'window-close-consume',
    owners: [
      { layer: 'app', role: 'composable' },
      { layer: 'app', role: 'component' },
    ],
  },
  {
    role: 'orchestrator',
    domain: 'settings-persistence',
    names: ['startSettingsPersistence', 'startSettingsMirror'],
    capability: 'settings-lifecycle',
    owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
  },
  {
    role: 'orchestrator',
    domain: 'settings-persistence',
    names: ['saveLogDirectory'],
    capability: 'settings-log-directory',
    owners: [{ layer: 'app', role: 'composable', domain: 'settings-view-model' }],
  },
  {
    role: 'orchestrator',
    domain: 'settings-persistence',
    names: ['flushSettings'],
    capability: 'settings-close-flush',
    owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
  },
  {
    role: 'external',
    domain: '@tauri-apps/api/core',
    names: ['invoke'],
    capability: 'invoke-wire',
    owners: [{ path: 'src/shared/runtime/command.runtime.ts', layer: 'shared', domain: 'runtime' }],
  },
  ...['naive-ui', 'naive-ui/es/message', 'naive-ui/es/dialog', 'naive-ui/es/discrete'].map((domain) => ({
    role: 'external',
    domain,
    names: ['useMessage', 'useDialog', 'createDiscreteApi'],
    capability: 'feedback-runtime',
    owners: [{ path: 'src/app/WindowRuntime.vue', layer: 'app' }],
  })),
  {
    role: 'service',
    domain: 'entity-query',
    names: ['querySessionEntity', 'querySessionEntityIdentityIntent', 'querySessionEntityList'],
    capability: 'session-query-load',
    owners: [{ layer: 'services' }],
  },
  {
    role: 'service',
    domain: 'entity-query',
    names: ['querySessionEntityEditTarget'],
    capability: 'entity-target-read',
    owners: [
      { layer: 'orchestrators', domain: 'edit-target-handoff' },
      { layer: 'services' },
      { layer: 'orchestrators', domain: 'entity-identity' },
      { layer: 'app', role: 'composable', domain: 'workspace-shell-actions' },
      { layer: 'orchestrators', domain: 'window-target-focus' },
    ],
  },
  {
    role: 'service',
    domain: 'source-options',
    names: ['querySourceOptionCatalog'],
    capability: 'source-query',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'resource-reference',
    names: ['querySessionDraftResources'],
    capability: 'draft-resource-query',
    owners: [{ layer: 'services' }],
  },
  {
    role: 'service',
    domain: 'resource-reference',
    names: ['resolveModImageReference'],
    capability: 'resource-reference',
    owners: [{ layer: 'app', role: 'composable', domain: 'resource-reference' }],
  },
  {
    role: 'service',
    domain: 'hull-reference',
    names: ['querySessionHullReferences', 'queryHullReferenceOptions', 'queryBuiltInWeaponSlotOptions'],
    capability: 'hull-query',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'csv-table',
    names: ['queryTableIndex', 'queryTableRows', 'querySessionCsvRowPreview', 'queryTableRowPreviewDataUrl'],
    capability: 'table-query',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'csv-table',
    names: ['captureAssociatedSpecTarget'],
    capability: 'table-identity-prepare',
    owners: [{ layer: 'orchestrators', domain: 'table-save' }],
  },
  {
    role: 'service',
    domain: 'config-entity',
    names: ['saveModInfo', 'saveIndexedConfigEntity', 'createIndexedConfigEntity', 'deleteIndexedConfigEntity'],
    capability: 'config-write',
    owners: [{ layer: 'orchestrators', domain: 'config-save' }],
  },
  {
    role: 'service',
    domain: 'config-entity',
    names: [
      'captureConfigIdentityIntent',
      'listConfigFactionRecords',
      'listConfigMissionRecords',
      'getConfigFactionRecord',
      'queryFactionPreviewImages',
      'queryMissionDraftIcon',
      'getConfigMissionEditorData',
    ],
    capability: 'config-query',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'config-family',
    names: ['saveVariantEntity', 'createVariantEntity', 'deleteVariantEntity', 'saveSkinEntity', 'createSkinEntity', 'deleteSkinEntity'],
    capability: 'config-write',
    owners: [{ layer: 'orchestrators', domain: 'config-save' }],
  },
  {
    role: 'service',
    domain: 'config-family',
    names: ['listVariantRecords', 'getConfigFamilyRecord', 'listSkinRecords'],
    capability: 'config-query',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'csv-table',
    names: ['saveCsvPatch'],
    capability: 'table-write',
    owners: [{ layer: 'orchestrators', domain: 'table-save' }],
  },
  {
    role: 'service',
    domain: 'spec-editor',
    names: ['saveSpecEditorSpec', 'saveSpecEditorSpecByKind'],
    capability: 'spec-write',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'spec-ship-editor',
    names: ['querySpecShipEditorData', 'querySpecShipEditorImages', 'querySpecShipWeaponSources'],
    capability: 'spec-ship-editor-read',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'spec-system-editor',
    names: ['querySpecSystemEditorData'],
    capability: 'spec-system-editor-read',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'spec-editor',
    names: ['querySpecEditorIdentityIntent'],
    capability: 'editor-query',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'spec-editor',
    names: ['loadSpecEditorImport'],
    capability: 'spec-import',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'files',
    names: ['writeEditableFileText', 'transcodeFileToUtf8'],
    capability: 'text-write',
    owners: readOwners.concat([{ path: 'src/app/app-feedback-assembly.ts', layer: 'app' }]),
  },
  {
    role: 'service',
    domain: 'file-history',
    names: ['replayFileChangeSet'],
    capability: 'history-replay',
    owners: [{ layer: 'orchestrators', domain: 'file-history-replay' }],
  },
  {
    role: 'service',
    domain: 'file-history',
    names: ['loadFileHistory', 'clearSavedFileHistory'],
    capability: 'history-wire',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'files',
    names: ['loadEditableFileData', 'queryFileTextIdentityIntent', 'followFileTextIdentity'],
    capability: 'text-read',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'query-cache',
    names: ['createCachedSessionQuery', 'createLiveSessionQuery'],
    capability: 'query-cache-load',
    owners: ['entity-query', 'csv-table', 'source-options', 'hull-reference', 'resource-reference', 'joint-edit'].map((domain) => ({
      layer: 'services',
      domain,
    })),
  },
  {
    role: 'service',
    domain: 'query-cache',
    names: ['subscribeQueryInvalidations', 'hasQueryInvalidation'],
    capability: 'cache-observe',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'resource-cache',
    names: ['subscribeResourceInvalidations', 'hasResourceInvalidation', 'mediaResourceKey', 'resourceCacheCapacity'],
    capability: 'cache-observe',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'query-cache',
    names: ['invalidateQueryCacheByProject'],
    capability: 'project-cache-invalidate',
    owners: [{ layer: 'orchestrators', domain: 'project-sync' }],
  },
  {
    role: 'service',
    domain: 'resource-cache',
    names: ['invalidateResourceCacheByProject'],
    capability: 'project-cache-invalidate',
    owners: [{ layer: 'orchestrators', domain: 'project-sync' }],
  },
  {
    role: 'service',
    domain: 'query-cache',
    names: ['invalidateQueryCacheForSession'],
    capability: 'session-cache-clear',
    owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
  },
  {
    role: 'service',
    domain: 'resource-cache',
    names: ['invalidateResourceCacheForSession'],
    capability: 'session-cache-clear',
    owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
  },
  {
    role: 'service',
    domain: 'resource-cache',
    names: ['queryResourceDataUrls'],
    capability: 'resource-load',
    owners: ['config-resource', 'csv-table', 'spec-ship-editor', 'weapon-data', 'resource-media', 'spec-projectile-editor'].map(
      (domain) => ({
        layer: 'services',
        domain,
      }),
    ),
  },
  {
    role: 'service',
    domain: 'project-session',
    names: ['openProject'],
    capability: 'session-open',
    owners: [{ layer: 'orchestrators', domain: 'directory-opening' }],
  },
  {
    role: 'service',
    domain: 'project-session',
    names: ['closeProject'],
    capability: 'session-close',
    owners: ['directory-opening', 'workspace-lifecycle'].map((domain) => ({ layer: 'orchestrators', domain })),
  },
  {
    role: 'service',
    domain: 'project-sync',
    names: ['requestProjectSessionRefresh', 'refreshProjectSources'],
    capability: 'session-refresh',
    owners: [{ layer: 'orchestrators', domain: 'project-sync' }],
  },
  {
    role: 'service',
    domain: 'project-sync',
    names: ['synchronizeSessionCommit'],
    capability: 'commit-recovery',
    owners: [{ layer: 'orchestrators', domain: 'project-sync' }],
  },
  {
    role: 'service',
    domain: 'core-assets',
    names: ['invalidateCoreCacheForRoot'],
    capability: 'core-cache-clear',
    owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
  },
  {
    role: 'service',
    domain: 'directory',
    names: ['pickDirectory', 'detectDirectoryTarget', 'scanDirectoryGameOverview'],
    capability: 'directory-read',
    owners: [
      { layer: 'orchestrators', domain: 'directory-opening' },
      { layer: 'orchestrators', domain: 'workspace-persistence' },
      { layer: 'app', domain: 'workspace-shell-actions' },
    ],
  },
];

/** @param {string} rel @param {string} name @returns {CapabilityRule | undefined} */
export function capabilityFor(rel, name) {
  const target = classifyFrontendPath(rel);
  const domain = target.layer === 'external' ? rel : target.domain;
  return frontendCapabilities.find(
    (rule) =>
      (rule.path === undefined || rule.path === rel) &&
      (rule.layer === undefined || rule.layer === target.layer) &&
      rule.role === target.role &&
      rule.domain === domain &&
      rule.names.includes(name),
  );
}

/** @param {PathRole} role @param {string} rel @returns {boolean} */
export function hasCapabilityBoundary(role, rel) {
  return frontendCapabilities.some(
    (rule) =>
      (rule.path === undefined || rule.path === rel) &&
      (rule.layer === undefined || rule.layer === role.layer) &&
      rule.role === role.role &&
      rule.domain === role.domain,
  );
}

/** @param {import('./imports.mjs').ResolvedImport} edge @param {Map<string, import('./files.mjs').RepoFile>} nodes @returns {import('./imports.mjs').ExportOrigin[]} */
export function capabilityOrigins(edge, nodes) {
  return dependencyOrigins(
    edge,
    nodes,
    (rel, name) => Boolean(capabilityFor(rel, name)),
    (rel) => frontendCapabilities.filter((rule) => rule.role === 'external' && rule.domain === rel).flatMap((rule) => rule.names),
  );
}

/** @param {PathRole} current @param {PathRole} target @param {import('./imports.mjs').ResolvedImport} edge @returns {string | null} */
export function frontendDependencyFailure(current, target, edge) {
  if (current.role === 'bootstrap' && target.layer === 'styles') return null;
  if (!validFrontendDependency(current.layer, target.layer)) return `${current.layer} must not import ${target.layer}`;
  const queryKernel = current.path === 'src/services/query-cache.service.ts' || current.path === 'src/shared/types/query-cache.types.ts';
  const businessQuery = [
    'src/services/entity-query.service.ts',
    'src/services/csv-table.service.ts',
    'src/services/source-options.service.ts',
    'src/services/hull-reference.service.ts',
    'src/services/resource-reference.service.ts',
    'src/services/joint-edit.service.ts',
    'src/shared/types/entity-query.types.ts',
    'src/shared/types/tables.types.ts',
    'src/shared/types/schema.types.ts',
    'src/shared/types/resources.types.ts',
    'src/shared/types/joint-edit.types.ts',
  ];
  if (queryKernel && businessQuery.includes(target.path)) return 'session query foundations must be consumed by business queries';
  const budgetFoundation = [
    'src/shared/runtime/cache-limits.ts',
    'src/shared/types/cache-limits.types.ts',
    'src/domain/cache-limits.ts',
  ].includes(current.path);
  if (
    budgetFoundation &&
    (target.domain === 'settings' ||
      target.domain === 'app-settings' ||
      target.path === 'src/shared/types/app-settings.types.ts' ||
      target.path === 'src/shared/types/query-cache.types.ts')
  )
    return 'cache budgets must be consumed by settings and session queries';
  const foundation =
    (current.layer === 'services' &&
      [
        'project-session',
        'project-projection',
        'query-cache',
        'resource-cache',
        'resource-media',
        'resource-reference',
        'resource-budget',
      ].includes(current.domain ?? '')) ||
    (current.layer === 'stores' && current.domain === 'project');
  if (foundation && target.domain === 'project-sync')
    return 'session, query and resource foundations must be consumed by project synchronization';
  if (!edge.typeOnly && current.role === 'component' && ['service', 'orchestrator'].includes(target.role))
    return 'components must consume ViewModel/composable state and actions';
  if (!edge.typeOnly && current.layer === 'services' && target.layer === 'services' && !allowedServiceEdge(current, target))
    return 'service composition must follow the declared capability dependency matrix';
  const runtimeOwner = current.layer === 'windows' || (current.layer === 'shared' && current.domain === 'runtime');
  if (!edge.typeOnly && edge.specifier.startsWith('@tauri-apps/') && !runtimeOwner)
    return 'Tauri runtime access belongs behind window or shared runtime boundaries';
  return null;
}

/** @param {PathRole} current @param {CapabilityRule} capability @returns {boolean} */
export function canConsumeCapability(current, capability) {
  return capability.owners.some((owner) => matchesOwner(current, owner));
}

/** @param {PathRole} current @param {Owner} owner @returns {boolean} */
function matchesOwner(current, owner) {
  return (
    (owner.path === undefined || current.path === owner.path) &&
    current.layer === owner.layer &&
    (owner.domain === undefined || current.domain === owner.domain) &&
    (owner.role === undefined || current.role === owner.role)
  );
}

const serviceEdges = new Set([
  'query-cache -> project-projection',
  'resource-cache -> project-projection',
  'resource-media -> project-projection',
  'resource-cache -> resource-budget',
  'resource-media -> resource-budget',
  'entity-query -> query-cache',
  'csv-table -> query-cache',
  'joint-edit -> query-cache',
  'source-options -> query-cache',
  'hull-reference -> query-cache',
  'resource-reference -> query-cache',
  'weapon-data -> resource-reference',
  'spec-weapon-editor -> resource-reference',
  'spec-projectile-editor -> resource-reference',
  'spec-ship-editor -> resource-reference',
  'config-entity -> resource-reference',
  'resource-media -> resource-cache',
  'config-entity -> config-resource',
  'config-entity -> entity-query',
  'config-family -> entity-query',
  'config-resource -> resource-cache',
  'csv-table -> entity-query',
  'csv-table -> resource-cache',
  'spec-weapon-editor -> weapon-data',
  'spec-weapon-editor -> entity-query',
  'spec-projectile-editor -> entity-query',
  'spec-projectile-editor -> resource-cache',
  'weapon-fire-preview -> entity-query',
  'weapon-data -> entity-query',
  'weapon-data -> resource-cache',
  'weapon-fire-preview -> weapon-data',
  'spec-editor -> files',
  'spec-editor -> entity-query',
  'spec-ship-editor -> entity-query',
  'spec-ship-editor -> joint-edit',
  'spec-ship-editor -> resource-cache',
  'spec-system-editor -> entity-query',
]);

/** @param {PathRole} from @param {PathRole} to @returns {boolean} */
export function allowedServiceEdge(from, to) {
  return from.domain === to.domain || serviceEdges.has(`${from.domain} -> ${to.domain}`);
}

/** @param {import('./classify.mjs').FrontendLayer} from @param {import('./classify.mjs').FrontendLayer} to @returns {boolean} */
export function validFrontendDependency(from, to) {
  if (from === 'test') return true;
  if (to === 'test') return false;
  /** @type {Record<string, string[]>} */
  const layers = {
    shared: ['shared'],
    domain: ['domain', 'shared'],
    services: ['services', 'domain', 'shared'],
    stores: ['stores', 'domain', 'shared'],
    orchestrators: ['orchestrators', 'services', 'stores', 'domain', 'windows', 'shared'],
    windows: ['windows', 'orchestrators', 'services', 'domain', 'shared'],
    app: ['app', 'windows', 'orchestrators', 'services', 'stores', 'domain', 'shared'],
    styles: ['styles'],
  };
  return !layers[from] || !layers[to] || layers[from].includes(to);
}

/** @param {import('./files.mjs').RepoFile} file @param {import('./imports.mjs').ResolvedImport} edge @param {string} message @returns {string} */
export function dependencyDiagnostic(file, edge, message) {
  return `${file.rel}:${edge.line}:${edge.column}: ${edge.resolved}: ${message}`;
}
