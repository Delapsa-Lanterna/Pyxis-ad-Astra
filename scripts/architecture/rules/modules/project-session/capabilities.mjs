import { capabilities, readOwners } from '../../capabilities/owners.mjs';

export const projectCapabilities = [
  ...capabilities({ role: 'orchestrator', domain: 'project-sync' }, [
    {
      capability: 'close-display',
      names: ['pauseProjectDisplay'],
      owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
    },
    {
      capability: 'commit-synchronize',
      names: ['publishCommittedWrite'],
      owners: [
        { layer: 'orchestrators', domain: 'file-history-replay' },
        { layer: 'orchestrators', domain: 'editor-window' },
        { layer: 'orchestrators', domain: 'file-editor-window' },
      ],
    },
    {
      capability: 'commit-retry',
      names: ['retryPendingModSyncs'],
      owners: [
        { layer: 'orchestrators', domain: 'csv-save' },
        { layer: 'orchestrators', domain: 'json-save' },
        { layer: 'orchestrators', domain: 'file-history-replay' },
        { layer: 'orchestrators', domain: 'workspace-lifecycle' },
        { layer: 'app', role: 'composable', domain: 'workspace-shell-actions' },
        { layer: 'app', role: 'composable', domain: 'csv-save-participants' },
        { layer: 'app', role: 'composable', domain: 'json-list-selection' },
      ],
    },
    { capability: 'source-refresh', names: ['refreshProjectSourcePaths'], owners: [{ layer: 'app', role: 'composable' }] },
    {
      capability: 'commit-retry',
      names: ['retryPendingSessionSyncs'],
      owners: [{ layer: 'app', role: 'composable', domain: 'write-sync-view-model' }],
    },
    {
      capability: 'commit-observe',
      names: ['invalidateProjectionCaches', 'listenCommittedWrites', 'listenProjectSessionInvalidated', 'listenEntityIdentityApplied'],
      owners: [{ layer: 'orchestrators' }, { layer: 'app', role: 'composable' }],
    },
    {
      capability: 'commit-complete',
      names: ['completeSavedWrite'],
      owners: [
        { layer: 'orchestrators', domain: 'json-save' },
        { layer: 'orchestrators', domain: 'csv-save' },
        { layer: 'app', role: 'composable', domain: 'joint-edit-session' },
        { layer: 'app', role: 'composable', domain: 'csv-save-participants' },
      ],
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
    { capability: 'command-transport', names: ['invokeCommand'], owners: [{ layer: 'services' }] },
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
    {
      capability: 'projection-state',
      names: ['markProjectionReady'],
      owners: [
        { layer: 'orchestrators', domain: 'project-sync' },
        { layer: 'orchestrators', domain: 'workspace-lifecycle' },
      ],
    },
    {
      capability: 'projection-read',
      names: ['requireProjectionReady'],
      owners: [
        { layer: 'services', domain: 'query-cache' },
        { layer: 'services', domain: 'resource-media' },
      ],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'query-cache' }, [
    {
      capability: 'query-cache-load',
      names: ['createCachedSessionQuery', 'createLiveSessionQuery'],
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
      capability: 'session-refresh',
      names: ['requestProjectSessionRefresh', 'refreshProjectSources'],
      owners: [{ layer: 'orchestrators', domain: 'project-sync' }],
    },
    { capability: 'commit-recovery', names: ['synchronizeSessionCommit'], owners: [{ layer: 'orchestrators', domain: 'project-sync' }] },
  ]),
  ...capabilities({ role: 'service', domain: 'directory' }, [
    {
      capability: 'directory-read',
      names: ['pickDirectory', 'detectDirectoryTarget', 'scanDirectoryGameOverview'],
      owners: [
        { layer: 'orchestrators', domain: 'directory-opening' },
        { layer: 'orchestrators', domain: 'workspace-persistence' },
        { layer: 'app', domain: 'workspace-shell-actions' },
      ],
    },
  ]),
];
