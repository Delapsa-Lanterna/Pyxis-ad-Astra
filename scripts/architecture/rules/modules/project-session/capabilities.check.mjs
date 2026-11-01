import { testCapabilities } from '../../../testing/capabilities.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { capabilityBoundaryRule } from '../../capabilities/capability-boundary.mjs';
/** @type {Parameters<typeof testCapabilities>[0]} */
const cases = [
  [
    'workspace-core-source',
    'src/app/composables/settings/use-settings-view-model.ts',
    'src/orchestrators/workspace-core-source.orchestrator.ts',
    'switchWorkspaceCoreSource',
  ],
  [
    'source-directory-detect',
    'src/orchestrators/workspace-core-source.orchestrator.ts',
    'src/services/directory.service.ts',
    'detectDirectoryTarget',
  ],
  [
    'opening-directory-detect',
    'src/orchestrators/workspace-opening.orchestrator.ts',
    'src/services/directory.service.ts',
    'detectDirectoryTarget',
  ],
  [
    'reference-readiness',
    'src/orchestrators/project-sync.orchestrator.ts',
    'src/services/project-projection.service.ts',
    'setReferenceReadiness',
  ],
  [
    'reference-publication',
    'src/app/composables/use-workspace-shell-lifecycle.ts',
    'src/orchestrators/project-sync.orchestrator.ts',
    'publishReferenceSources',
  ],
  [
    'reference-registration',
    'src/orchestrators/project-sync.orchestrator.ts',
    'src/services/project-sync.service.ts',
    'setReferenceSources',
  ],
  ['save-retry', 'src/orchestrators/project-sync.orchestrator.ts', 'src/services/project-sync.service.ts', 'retryProjectSave'],
  [
    'commit-complete',
    'src/app/composables/json-editor/use-json-document-session.ts',
    'src/orchestrators/project-sync.orchestrator.ts',
    'beginSavedWrite',
  ],
  [
    'commit-publication',
    'src/app/composables/use-write-sync-view-model.ts',
    'src/orchestrators/project-sync.orchestrator.ts',
    'retryPendingWrites',
  ],
  [
    'projection-pending-owner',
    'src/orchestrators/project-sync.orchestrator.ts',
    'src/services/project-projection.service.ts',
    'markProjectionPending',
  ],
  ['projection-read-owner', 'src/services/query-cache.service.ts', 'src/services/project-projection.service.ts', 'requireProjectionReady'],
  ['entity-target-query', 'src/services/spec-editor.service.ts', 'src/services/entity-query.service.ts', 'querySessionEntityEditTarget'],
  [
    'identity-target-query',
    'src/orchestrators/spec-editor-identity.orchestrator.ts',
    'src/services/entity-query.service.ts',
    'querySessionEntityEditTarget',
  ],
  [
    'file-open-target-query',
    'src/app/composables/csv-editor/use-csv-editor-actions.ts',
    'src/services/entity-query.service.ts',
    'querySessionEntityEditTarget',
  ],
  [
    'entity-intent-query',
    'src/services/spec-editor.service.ts',
    'src/services/entity-query.service.ts',
    'querySessionEntityIdentityIntent',
  ],
  ['entity-detail-read', 'src/app/composables/use-sample.ts', 'src/services/entity-query.service.ts', 'querySessionEntity'],
  ['entity-list-read', 'src/orchestrators/sample.orchestrator.ts', 'src/services/entity-query.service.ts', 'querySessionEntityList'],
  [
    'csv-commit-complete',
    'src/app/composables/csv-editor/use-csv-save-participants.ts',
    'src/orchestrators/project-sync.orchestrator.ts',
    'beginSavedWrite',
  ],
  ['query-cache-load', 'src/services/entity-query.service.ts', 'src/services/query-cache.service.ts', 'CachedSessionQuery'],
  ['live-query-load', 'src/services/entity-query.service.ts', 'src/services/query-cache.service.ts', 'readLiveSessionQuery'],
  ['source-query', 'src/app/composables/use-sample.ts', 'src/services/source-options.service.ts', 'querySourceOptionCatalog'],
  ['source-query', 'src/app/composables/use-sample.ts', 'src/services/source-options.service.ts', 'queryImageSourceOptions'],
  ['query-observe', 'src/app/composables/use-sample.ts', 'src/services/query-cache.service.ts', 'subscribeQueryInvalidations'],
  [
    'query-project-invalidate',
    'src/orchestrators/project-sync.orchestrator.ts',
    'src/services/query-cache.service.ts',
    'invalidateQueryCacheByProject',
  ],
  [
    'query-session-clear',
    'src/orchestrators/workspace-lifecycle.orchestrator.ts',
    'src/services/query-cache.service.ts',
    'invalidateQueryCacheForSession',
  ],
  ['session-open', 'src/orchestrators/workspace-opening.orchestrator.ts', 'src/services/project-session.service.ts', 'openProject'],
  ['session-close', 'src/orchestrators/workspace-lifecycle.orchestrator.ts', 'src/services/project-sync.service.ts', 'closeProjectSession'],
  [
    'late-session-close',
    'src/orchestrators/workspace-opening.orchestrator.ts',
    'src/services/project-sync.service.ts',
    'closeProjectSession',
  ],
  [
    'session-refresh',
    'src/orchestrators/project-sync.orchestrator.ts',
    'src/services/project-sync.service.ts',
    'requestProjectSessionRefresh',
  ],
  ['directory-read', 'src/app/composables/use-workspace-shell-actions.ts', 'src/services/directory.service.ts', 'pickDirectory'],
  [
    'overview-restore',
    'src/orchestrators/workspace-persistence.orchestrator.ts',
    'src/services/directory.service.ts',
    'scanDirectoryGameOverview',
  ],
];

testCapabilities(cases);

test('source switching directory authorization follows its actual detection capability', () => {
  const provider = {
    'src/services/directory.service.ts':
      'export function detectDirectoryTarget() {} export function scanDirectoryGameOverview() {} export function pickDirectory() {}',
  };
  for (const [consumer, symbol] of /** @type {[string, string][]} */ ([
    ['src/orchestrators/settings-persistence.orchestrator.ts', 'detectDirectoryTarget'],
    ['src/orchestrators/workspace-core-source.orchestrator.ts', 'scanDirectoryGameOverview'],
    ['src/orchestrators/workspace-core-source.orchestrator.ts', 'pickDirectory'],
  ])) {
    const context = architectureFixtures({
      ...provider,
      [consumer]: `import {${symbol} as run} from '@/services/directory.service'; run();`,
    });
    const [diagnostic] = capabilityBoundaryRule.check(context);
    assert.ok(diagnostic);
    assert.equal(diagnostic.file, consumer);
    assert.equal(diagnostic.symbol, symbol);
    assert.equal(diagnostic.line, 1);
  }
});
