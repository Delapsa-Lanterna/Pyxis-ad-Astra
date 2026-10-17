import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { frontendLayerBoundaryRule } from './rules/frontend-layer-boundary.mjs';
import { writeBoundaryRule } from './rules/write-boundary.mjs';
import { projectSessionBoundaryRule } from './rules/project-session-boundary.mjs';

for (const source of [
  'src/services/project-session.service.ts',
  'src/services/project-projection.service.ts',
  'src/services/query-cache.service.ts',
  'src/services/resource-cache.service.ts',
  'src/services/resource-media.service.ts',
  'src/services/resource-reference.service.ts',
  'src/services/resource-budget.service.ts',
  'src/stores/project.store.ts',
]) {
  for (const dependency of [
    "import type { State } from '@/stores/project-sync.store';",
    "const sync = import('@/stores/project-sync.store');",
    "export { type State } from '@/stores/project-sync.store';",
  ]) {
    test(source + ' retains its foundation boundary for ' + dependency.split(' ')[0], () => {
      const files = architectureFixtures({
        [source]: dependency,
        'src/stores/project-sync.store.ts': 'export interface State {}',
      });
      const failures = [...frontendLayerBoundaryRule.check(files), ...writeBoundaryRule.check(files)];
      assert.equal(failures.length, 1);
    });
  }
}

test('project synchronization consumes formal cache and projection capabilities', () => {
  const files = architectureFixtures({
    'src/orchestrators/project-sync.orchestrator.ts':
      "import { invalidateResourceCacheByProject } from '@/services/resource-cache.service'; import { invalidateQueryCacheByProject } from '@/services/query-cache.service'; import { markProjectionReady } from '@/services/project-projection.service';",
    'src/services/resource-cache.service.ts': 'export function invalidateResourceCacheByProject() {}',
    'src/services/query-cache.service.ts': 'export function invalidateQueryCacheByProject() {}',
    'src/services/project-projection.service.ts': 'export function markProjectionReady() {}',
  });
  assert.deepEqual(frontendLayerBoundaryRule.check(files), []);
  assert.deepEqual(writeBoundaryRule.check(files), []);
});

test('project synchronization owns formal manifest replacement', () => {
  const legal = architectureFixtures({ 'src/orchestrators/project-sync.orchestrator.ts': 'project.replaceProjectManifest(manifest, 1);' });
  assert.deepEqual(projectSessionBoundaryRule.check(legal), []);
  const invalid = architectureFixtures({ 'src/orchestrators/example.orchestrator.ts': 'project.replaceProjectManifest(manifest, 1);' });
  assert.equal(projectSessionBoundaryRule.check(invalid).length, 1);
});

for (const dependency of [
  "import { useWorkspaceStore } from '@/stores/workspace.store';",
  "import type { State } from '@/stores/workspace.store';",
  "const workspace = import('@/stores/workspace.store');",
  "export { type State } from '@/stores/workspace.store';",
])
  test('project manifests stay independent of workspace for ' + dependency, () => {
    const files = architectureFixtures({
      'src/stores/project.store.ts': dependency,
      'src/stores/workspace.store.ts': 'export interface State {} export function useWorkspaceStore() {}',
    });
    assert.equal(projectSessionBoundaryRule.check(files).length, 1);
  });

test('workspace derives active project projection through the manifest owner', () => {
  const files = architectureFixtures({
    'src/stores/project.store.ts': 'export function useProjectStore() {}',
    'src/stores/workspace.store.ts':
      "import { useProjectStore } from '@/stores/project.store'; const activeManifest = computed(() => useProjectStore().getManifest(root));",
  });
  assert.deepEqual(projectSessionBoundaryRule.check(files), []);
});

test('active project fields belong to workspace', () => {
  const files = architectureFixtures({ 'src/stores/project.store.ts': 'const activeSessionId = computed(() => null);' });
  assert.equal(projectSessionBoundaryRule.check(files).length, 1);
});

for (const store of ['project', 'workspace', 'settings'])
  test('Core receives a root instead of reading ' + store, () => {
    const files = architectureFixtures({
      'src/orchestrators/core-assets.orchestrator.ts': `import type { State } from '@/stores/${store}.store';`,
      [`src/stores/${store}.store.ts`]: 'export interface State {}',
    });
    assert.equal(projectSessionBoundaryRule.check(files).length, 1);
  });

test('Core accepts the explicit reactive root supplied by its window', () => {
  const files = architectureFixtures({
    'src/orchestrators/core-assets.orchestrator.ts':
      "import type { Ref } from 'vue'; export function startCoreAssetsLoading(root: Readonly<Ref<string | null>>) { return () => {}; }",
  });
  assert.deepEqual(projectSessionBoundaryRule.check(files), []);
});
