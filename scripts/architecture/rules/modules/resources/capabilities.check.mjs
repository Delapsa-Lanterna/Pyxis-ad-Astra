import { testCapabilities } from '../../../testing/capabilities.mjs';

/** @type {Parameters<typeof testCapabilities>[0]} */
const cases = [
  ['core-root-read', 'src/app/composables/use-core-assets.ts', 'src/services/core-assets.service.ts', 'queryCoreRoot'],
  ['core-fields-read', 'src/orchestrators/core-assets.orchestrator.ts', 'src/services/core-assets.service.ts', 'queryCoreFields'],
  [
    'core-source-watch',
    'src/orchestrators/core-assets.orchestrator.ts',
    'src/services/core-assets.service.ts',
    'setWindowCoreSubscription',
  ],
  ['core-graphics-read', 'src/orchestrators/core-assets.orchestrator.ts', 'src/services/core-assets.service.ts', 'queryCoreGraphics'],
  [
    'core-refresh-clear',
    'src/orchestrators/core-assets.orchestrator.ts',
    'src/services/core-assets.service.ts',
    'invalidateCoreCacheForRoot',
  ],
  ['hull-query', 'src/app/composables/use-sample.ts', 'src/services/hull-reference.service.ts', 'queryHullReferenceOptions'],
  [
    'immersive-hull-query',
    'src/app/composables/immersive-editor/use-immersive-editor-runtime.ts',
    'src/services/hull-reference.service.ts',
    'querySessionHullReferences',
  ],
  [
    'resource-reference',
    'src/app/composables/editors/use-resource-reference.ts',
    'src/services/resource-reference.service.ts',
    'resolveModImageReference',
  ],
  ['resource-observe', 'src/app/composables/use-sample.ts', 'src/services/resource-media.service.ts', 'hasResourceInvalidation'],
  ['resource-key', 'src/app/composables/use-sample.ts', 'src/services/resource-media.service.ts', 'mediaResourceKey'],
  ['resource-read', 'src/services/spec-ship-editor.service.ts', 'src/services/resource-media.service.ts', 'queryResourceDataUrls'],
  [
    'draft-resource-query',
    'src/services/spec-ship-editor.service.ts',
    'src/services/resource-reference.service.ts',
    'querySessionDraftResources',
  ],
  [
    'resource-project-invalidate',
    'src/orchestrators/project-sync.orchestrator.ts',
    'src/services/resource-media.service.ts',
    'invalidateResourceMediaByProject',
  ],
  [
    'resource-session-clear',
    'src/orchestrators/workspace-lifecycle.orchestrator.ts',
    'src/services/resource-media.service.ts',
    'invalidateResourceMediaForSession',
  ],
  [
    'core-clear',
    'src/orchestrators/workspace-lifecycle.orchestrator.ts',
    'src/services/core-assets.service.ts',
    'invalidateCoreCacheForRoot',
  ],
];

testCapabilities(cases);
