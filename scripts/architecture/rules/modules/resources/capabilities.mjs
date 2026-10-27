import { capabilities, readOwners } from '../../capabilities/owners.mjs';

export const resourcesCapabilities = [
  ...capabilities({ role: 'service', domain: 'resource-media' }, [
    {
      capability: 'media-dispatch',
      names: ['dispatchResourceMedia'],
      owners: [
        { layer: 'app', role: 'composable', domain: 'resource-media-registry' },
        { layer: 'services', domain: 'resource-media' },
      ],
    },
    {
      capability: 'media-residence',
      names: [
        'acquireResourceMedia',
        'resourceMediaDataUrl',
        'mediaIdleByteLimit',
        'resourceMediaStats',
        'disposeResourceMedia',
        'RESOURCE_MEDIA_FLUSH_DELAY_MS',
      ],
      owners: readOwners,
    },
    {
      capability: 'cache-observe',
      names: ['subscribeResourceInvalidations', 'hasResourceInvalidation', 'mediaResourceKey', 'mediaIdleEntryLimit'],
      owners: readOwners,
    },
    {
      capability: 'project-cache-invalidate',
      names: ['invalidateResourceMediaByProject'],
      owners: [{ layer: 'orchestrators', domain: 'project-sync' }],
    },
    {
      capability: 'session-cache-clear',
      names: ['invalidateResourceMediaForSession'],
      owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
    },
    {
      capability: 'resource-load',
      names: ['queryResourceDataUrls'],
      owners: [
        { layer: 'services', domain: 'json-resource' },
        { layer: 'services', domain: 'csv-table' },
        { layer: 'services', domain: 'spec-ship-editor' },
        { layer: 'services', domain: 'weapon-data' },
        { layer: 'services', domain: 'resource-media' },
        { layer: 'services', domain: 'spec-projectile-editor' },
      ],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'engine-assets' }, [
    {
      capability: 'engine-assets-read',
      names: ['queryEngineRenderAssets', 'hasEngineAssetsInvalidation'],
      owners: [{ layer: 'app', role: 'composable', domain: 'engine-rendering' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'core-assets' }, [
    {
      capability: 'core-index-read',
      names: ['queryCoreFields', 'queryCoreGraphics'],
      owners: [{ layer: 'orchestrators', domain: 'core-assets' }],
    },
    {
      capability: 'core-cache-clear',
      names: ['invalidateCoreCacheForRoot'],
      owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'resource-reference' }, [
    { capability: 'draft-resource-query', names: ['querySessionDraftResources'], owners: [{ layer: 'services' }] },
    {
      capability: 'resource-reference',
      names: ['resolveModImageReference'],
      owners: [{ layer: 'app', role: 'composable', domain: 'resource-reference' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'hull-reference' }, [
    { capability: 'cache-observe', names: ['hasHullReferencesInvalidation'], owners: readOwners },
    {
      capability: 'hull-query',
      names: ['querySessionHullReferences', 'queryHullReferenceOptions', 'queryBuiltInWeaponSlotOptions'],
      owners: readOwners,
    },
  ]),
];
