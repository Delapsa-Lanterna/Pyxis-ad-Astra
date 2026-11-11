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
      owners: [{ layer: 'app', role: 'composable', domain: 'project-sync-view-model' }],
    },
    {
      capability: 'commit-observe',
      names: ['sessionContentUpdate', 'listenSavedContent', 'observeSavedContent', 'listenSavedIdentity', 'observeCoreContent'],
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
      owners: [{ layer: 'app', role: 'composable', domain: 'app-close-participant' }],
    },
    {
      capability: 'saved-content-wait',
      names: ['settleSavedContent'],
      owners: [{ path: 'src/app/composables/text-file-editing/use-text-file-batch.ts', layer: 'app' }],
    },
    {
      capability: 'session-release',
      names: ['releaseProjectContentConsumers'],
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
        { layer: 'orchestrators', domain: 'spec-editor-identity' },
        { layer: 'orchestrators', domain: 'window-target-focus' },
        { layer: 'services' },
        { layer: 'app', role: 'composable', domain: 'csv-editor-actions' },
        { layer: 'app', role: 'composable', domain: 'json-document-view' },
      ],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'source-catalog' }, [
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
  ...capabilities({ role: 'service', domain: 'file-browser' }, [
    {
      capability: 'file-browser-read',
      names: ['queryFileDirectory', 'queryFileSearch', 'queryFileTextTarget'],
      owners: [
        { layer: 'app', role: 'composable', domain: 'file-browser-view-model' },
        { path: 'src/app/composables/file-browser/use-file-browser.ts', layer: 'app' },
      ],
    },
  ]),
  ...capabilities({ path: 'src/shared/runtime/command.runtime.ts', layer: 'shared', role: 'shared', domain: 'runtime' }, [
    { capability: 'command-transport', names: ['invokeCommand', 'invokeSaveCommand', 'commandChannel'], owners: [{ layer: 'services' }] },
  ]),
  ...capabilities({ role: 'orchestrator', domain: 'workspace-core-source' }, [
    {
      capability: 'workspace-core-source',
      names: ['switchWorkspaceCoreSource'],
      owners: [{ path: 'src/app/composables/use-workspace-shell-actions.ts', layer: 'app' }],
    },
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
  ...capabilities({ role: 'service', domain: 'project-readiness' }, [
    { capability: 'session-readiness', names: ['markSessionPending'], owners: [{ layer: 'orchestrators', domain: 'project-sync' }] },
    { capability: 'reference-readiness', names: ['setReferenceReadiness'], owners: [{ layer: 'orchestrators', domain: 'project-sync' }] },
    {
      capability: 'session-readiness',
      names: ['markSessionReady', 'acceptReferenceRevision'],
      owners: [
        { layer: 'orchestrators', domain: 'project-sync' },
        { layer: 'orchestrators', domain: 'workspace-lifecycle' },
      ],
    },
    {
      capability: 'session-read',
      names: ['requireSessionReady', 'currentReferenceRevision', 'waitForReferenceSources'],
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
        { layer: 'services', domain: 'source-catalog' },
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
    { capability: 'session-open', names: ['openProject'], owners: [{ layer: 'orchestrators', domain: 'workspace-opening' }] },
  ]),
  ...capabilities({ role: 'service', domain: 'project-sync' }, [
    {
      capability: 'source-watch-retry',
      names: ['retrySourceWatch'],
      owners: [{ layer: 'app', role: 'composable', domain: 'project-sync-view-model' }],
    },
    {
      capability: 'session-close',
      names: ['closeProjectSession'],
      owners: [
        { layer: 'orchestrators', domain: 'workspace-opening' },
        { layer: 'orchestrators', domain: 'workspace-lifecycle' },
      ],
    },
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
      capability: 'directory-detect',
      names: ['detectDirectoryTarget'],
      owners: [
        { layer: 'orchestrators', domain: 'workspace-opening' },
        { layer: 'orchestrators', domain: 'workspace-core-source' },
      ],
    },
    {
      capability: 'directory-read',
      names: ['pickDirectory', 'scanDirectoryGameOverview'],
      owners: [
        { layer: 'orchestrators', domain: 'workspace-opening' },
        { layer: 'orchestrators', domain: 'workspace-persistence' },
        { layer: 'app', domain: 'workspace-shell-actions' },
      ],
    },
  ]),
];
