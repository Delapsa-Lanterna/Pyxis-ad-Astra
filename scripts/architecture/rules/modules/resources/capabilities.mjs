import { readOwners } from '../../capabilities/owners.mjs';

/** @type {import('../../capabilities/frontend-policy.mjs').CapabilityRule[]} */
export const resourcesCapabilities = [
  {
    role: 'service',
    domain: 'resource-media',
    names: ['dispatchResourceMedia'],
    capability: 'media-dispatch',
    owners: [
      { layer: 'app', role: 'composable', domain: 'resource-media-registry' },
      { layer: 'services', domain: 'resource-media' },
    ],
  },
  {
    role: 'service',
    domain: 'engine-assets',
    names: ['queryEngineRenderAssets', 'hasEngineAssetsInvalidation'],
    capability: 'engine-assets-read',
    owners: [{ layer: 'app', role: 'composable', domain: 'engine-rendering' }],
  },
  {
    role: 'service',
    domain: 'resource-media',
    names: [
      'acquireResourceMedia',
      'resourceMediaDataUrl',
      'mediaIdleByteLimit',
      'resourceMediaStats',
      'disposeResourceMedia',
      'RESOURCE_MEDIA_FLUSH_DELAY_MS',
    ],
    capability: 'media-residence',
    owners: readOwners,
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
    domain: 'resource-media',
    names: ['subscribeResourceInvalidations', 'hasResourceInvalidation', 'mediaResourceKey', 'mediaIdleEntryLimit'],
    capability: 'cache-observe',
    owners: readOwners,
  },
  {
    role: 'service',
    domain: 'resource-media',
    names: ['invalidateResourceMediaByProject'],
    capability: 'project-cache-invalidate',
    owners: [{ layer: 'orchestrators', domain: 'project-sync' }],
  },
  {
    role: 'service',
    domain: 'resource-media',
    names: ['invalidateResourceMediaForSession'],
    capability: 'session-cache-clear',
    owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
  },
  {
    role: 'service',
    domain: 'resource-media',
    names: ['queryResourceDataUrls'],
    capability: 'resource-load',
    owners: ['json-resource', 'csv-table', 'spec-ship-editor', 'weapon-data', 'resource-media', 'spec-projectile-editor'].map((domain) => ({
      layer: 'services',
      domain,
    })),
  },
  {
    role: 'service',
    domain: 'core-assets',
    names: ['invalidateCoreCacheForRoot'],
    capability: 'core-cache-clear',
    owners: [{ layer: 'orchestrators', domain: 'workspace-lifecycle' }],
  },
];
