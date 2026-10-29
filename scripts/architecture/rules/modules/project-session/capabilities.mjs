import { capabilities, readOwners } from '../../capabilities/owners.mjs';

export const projectCapabilities = [
  ...capabilities({ role: 'orchestrator', domain: 'project-sync' }, [
    {
      capability: 'workspace-reference-sources',
      names: ['publishReferenceSources'],
      owners: [{ layer: 'app', role: 'composable', domain: 'workspace-shell-lifecycle' }],
    },
    {
      capability: 'close-display',
      names: ['pauseProjectDisplay'],
      owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
    },
    { capability: 'source-refresh', names: ['refreshProjectSourcePaths'], owners: [{ layer: 'app', role: 'composable' }] },
    {
      capability: 'commit-retry',
      names: ['retryPendingSessionSyncs', 'retryPendingWrites'],
      owners: [{ layer: 'app', role: 'composable', domain: 'write-sync-view-model' }],
    },
    {
      capability: 'commit-observe',
      names: ['saveProjection', 'listenSavedContent', 'observeSavedContent', 'listenSavedIdentity'],
      owners: [{ layer: 'orchestrators' }, { layer: 'app', role: 'composable' }],
    },
    {
      capability: 'save-window-lifetime',
      names: ['startProjectSync'],
      owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
    },
    {
      capability: 'save-formal-acceptance',
      names: ['beginSavedWrite'],
      owners: [
        { layer: 'app', role: 'composable' },
        { layer: 'orchestrators', domain: 'csv-save' },
      ],
    },
    {
      capability: 'save-close-wait',
      names: ['settleProjectSaves'],
      owners: [{ layer: 'app', role: 'composable', domain: 'dirty-window-close-guard' }],
    },
    {
      capability: 'session-release',
      names: ['releaseProjectSession'],
      owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'entity-query' }, [
    {
      capability: 'cache-observe',
      names: ['hasEntityInvalidation'],
      owners: readOwners,
    },
    {
      capability: 'session-query-load',
      names: ['querySessionEntity', 'querySessionEntityList'],
      owners: readOwners,
    },
    { capability: 'session-identity-intent', names: ['querySessionEntityIdentityIntent'], owners: [{ layer: 'services' }] },
    {
      capability: 'entity-target-read',
      names: ['querySessionEntityEditTarget'],
      owners: [
        { layer: 'orchestrators', domain: 'edit-target-handoff' },
        { layer: 'orchestrators', domain: 'entity-identity' },
        { layer: 'orchestrators', domain: 'window-target-focus' },
        { layer: 'services' },
        { layer: 'app', role: 'composable', domain: 'csv-editor-actions' },
        { layer: 'app', role: 'composable', domain: 'json-document-view' },
      ],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'source-options' }, [
    {
      capability: 'cache-observe',
      names: ['hasSourceInvalidation'],
      owners: readOwners,
    },
    {
      capability: 'source-query',
      names: ['querySourceOptionCatalog', 'queryImageSourceOptions'],
      owners: readOwners,
    },
  ]),
  ...capabilities({ role: 'service', domain: 'csv-table' }, [
    {
      capability: 'cache-observe',
      names: ['hasTableInvalidation'],
      owners: readOwners,
    },
  ]),
  ...capabilities({ role: 'service', domain: 'mod-file-browser' }, [
    {
      capability: 'mod-file-browser-read',
      names: ['queryModDirectory', 'queryModFileSearch', 'queryModTextFileTarget'],
      owners: [{ layer: 'app', role: 'composable', domain: 'mod-file-browser-view-model' }],
    },
  ]),
  ...capabilities({ path: 'src/shared/runtime/command.runtime.ts', layer: 'shared', role: 'shared', domain: 'runtime' }, [
    { capability: 'command-transport', names: ['invokeCommand', 'invokeSaveCommand', 'commandChannel'], owners: [{ layer: 'services' }] },
  ]),
  ...capabilities({ role: 'service', domain: 'workspace-state' }, [
    {
      capability: 'workspace-persistence',
      names: ['loadPersistedWorkspace', 'savePersistedWorkspace'],
      owners: [{ layer: 'orchestrators', domain: 'workspace-persistence' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'mod-creation' }, [
    { capability: 'mod-create', names: ['createNewModProject'], owners: [{ layer: 'orchestrators', domain: 'mod-creation' }] },
  ]),
  ...capabilities({ role: 'service', domain: 'project-projection' }, [
    { capability: 'projection-state', names: ['markProjectionPending'], owners: [{ layer: 'orchestrators', domain: 'project-sync' }] },
    { capability: 'reference-readiness', names: ['setReferenceReadiness'], owners: [{ layer: 'orchestrators', domain: 'project-sync' }] },
    {
      capability: 'projection-state',
      names: ['markProjectionReady', 'acceptReferenceRevision'],
      owners: [
        { layer: 'orchestrators', domain: 'project-sync' },
        { layer: 'orchestrators', domain: 'workspace-lifecycle' },
      ],
    },
    {
      capability: 'projection-read',
      names: ['requireProjectionReady', 'currentReferenceRevision', 'waitForReferenceSources'],
      owners: [
        { layer: 'services', domain: 'query-cache' },
        { layer: 'services', domain: 'resource-media' },
      ],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'query-cache' }, [
    {
      capability: 'query-cache-load',
      names: ['CachedSessionQuery', 'readLiveSessionQuery'],
      owners: [
        { layer: 'services', domain: 'entity-query' },
        { layer: 'services', domain: 'csv-table' },
        { layer: 'services', domain: 'source-options' },
        { layer: 'services', domain: 'hull-reference' },
        { layer: 'services', domain: 'resource-reference' },
        { layer: 'services', domain: 'joint-edit' },
        { layer: 'services', domain: 'engine-assets' },
        { layer: 'services', domain: 'misc-config' },
      ],
    },
    {
      capability: 'cache-observe',
      names: ['subscribeQueryInvalidations', 'hasQueryInvalidation'],
      owners: readOwners,
    },
    {
      capability: 'project-cache-invalidate',
      names: ['invalidateQueryCacheByProject'],
      owners: [{ layer: 'orchestrators', domain: 'project-sync' }],
    },
    {
      capability: 'session-cache-clear',
      names: ['invalidateQueryCacheForSession'],
      owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'project-session' }, [
    { capability: 'session-open', names: ['openProject'], owners: [{ layer: 'orchestrators', domain: 'directory-opening' }] },
    {
      capability: 'session-close',
      names: ['closeProject'],
      owners: [
        { layer: 'orchestrators', domain: 'directory-opening' },
        { layer: 'orchestrators', domain: 'workspace-lifecycle' },
      ],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'project-sync' }, [
    {
      capability: 'save-window-delivery',
      names: [
        'registerSaveWindow',
        'unregisterSaveWindow',
        'abandonProjectSaves',
        'resolveSaveSources',
        'retryProjectSave',
        'waitProjectSaves',
        'setReferenceSources',
      ],
      owners: [{ layer: 'orchestrators', domain: 'project-sync' }],
    },
    {
      capability: 'session-refresh',
      names: ['requestProjectSessionRefresh', 'refreshProjectSources'],
      owners: [{ layer: 'orchestrators', domain: 'project-sync' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'directory' }, [
    {
      capability: 'directory-read',
      names: ['pickDirectory', 'detectDirectoryTarget', 'scanDirectoryGameOverview'],
      owners: [
        { layer: 'orchestrators', domain: 'directory-opening' },
        { layer: 'orchestrators', domain: 'workspace-persistence' },
        { layer: 'orchestrators', domain: 'settings-persistence' },
        { layer: 'app', domain: 'workspace-shell-actions' },
      ],
    },
  ]),
];
