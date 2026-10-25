import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../../testing/fixtures.mjs';

import { capabilityBoundaryRule } from '../../capabilities/capability-boundary.mjs';
import { frontendLayerBoundaryRule } from '../../dependencies/frontend-layer-boundary.mjs';

const cases = [
  [
    'config-list-retry',
    'src/app/composables/json-editor/use-json-list-selection.ts',
    'src/orchestrators/project-sync.orchestrator.ts',
    'retryPendingModSyncs',
  ],
  ['commit-recovery', 'src/orchestrators/project-sync.orchestrator.ts', 'src/services/project-sync.service.ts', 'synchronizeSessionCommit'],
  [
    'commit-complete',
    'src/orchestrators/json-save.orchestrator.ts',
    'src/orchestrators/project-sync.orchestrator.ts',
    'completeSavedWrite',
  ],
  [
    'commit-publication',
    'src/orchestrators/file-history-replay.orchestrator.ts',
    'src/orchestrators/project-sync.orchestrator.ts',
    'publishCommittedWrite',
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
    'src/orchestrators/entity-identity.orchestrator.ts',
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
    'completeSavedWrite',
  ],
  ['query-cache-load', 'src/services/entity-query.service.ts', 'src/services/query-cache.service.ts', 'createCachedSessionQuery'],
  ['live-query-load', 'src/services/entity-query.service.ts', 'src/services/query-cache.service.ts', 'createLiveSessionQuery'],
  ['source-query', 'src/app/composables/use-sample.ts', 'src/services/source-options.service.ts', 'querySourceOptionCatalog'],
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
  ['session-open', 'src/orchestrators/directory-opening.orchestrator.ts', 'src/services/project-session.service.ts', 'openProject'],
  ['session-close', 'src/orchestrators/workspace-lifecycle.orchestrator.ts', 'src/services/project-session.service.ts', 'closeProject'],
  ['late-session-close', 'src/orchestrators/directory-opening.orchestrator.ts', 'src/services/project-session.service.ts', 'closeProject'],
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

for (const [capability, from, target, name] of cases) {
  test(`${capability} is accepted at its formal owner`, () => {
    const source = `import { ${name} } from '@/${target.slice(4, -3)}';`;
    const files = architectureFixtures({
      [from]: from.endsWith('.vue') ? `<script setup>${source}</script><template><div /></template>` : source,
      [target]: `export function ${name}() {}`,
    });
    assert.deepEqual(messages(frontendLayerBoundaryRule.check(files)), []);
    assert.deepEqual(messages(capabilityBoundaryRule.check(files)), []);
  });
  test(`${capability} is rejected from a window capability consumer`, () => {
    const files = architectureFixtures({
      'src/windows/audit.window.ts': `import { ${name} } from '@/${target.slice(4, -3)}';`,
      [target]: `export function ${name}() {}`,
    });
    assert.equal([...messages(frontendLayerBoundaryRule.check(files)), ...messages(capabilityBoundaryRule.check(files))].length, 1);
  });
}
