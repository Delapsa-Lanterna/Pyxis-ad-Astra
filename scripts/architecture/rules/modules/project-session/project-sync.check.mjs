import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../../testing/fixtures.mjs';
import { frontendLayerBoundaryRule } from '../../dependencies/frontend-layer-boundary.mjs';
import { capabilityBoundaryRule } from '../../capabilities/capability-boundary.mjs';
import { projectSessionBoundaryRule } from './project-session-boundary.mjs';

for (const source of [
  'src/services/project-session.service.ts',
  'src/services/project-projection.service.ts',
  'src/services/query-cache.service.ts',
  'src/services/resource-media.service.ts',
  'src/services/resource-reference.service.ts',
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
      const failures = [...messages(frontendLayerBoundaryRule.check(files)), ...messages(capabilityBoundaryRule.check(files))];
      assert.equal(failures.length, 1);
    });
  }
}

test('project synchronization consumes formal cache and projection capabilities', () => {
  const files = architectureFixtures({
    'src/orchestrators/project-sync.orchestrator.ts':
      "import { invalidateResourceMediaByProject } from '@/services/resource-media.service'; import { invalidateQueryCacheByProject } from '@/services/query-cache.service'; import { markProjectionReady } from '@/services/project-projection.service';",
    'src/services/resource-media.service.ts': 'export function invalidateResourceMediaByProject() {}',
    'src/services/query-cache.service.ts': 'export function invalidateQueryCacheByProject() {}',
    'src/services/project-projection.service.ts': 'export function markProjectionReady() {}',
  });
  assert.deepEqual(messages(frontendLayerBoundaryRule.check(files)), []);
  assert.deepEqual(messages(capabilityBoundaryRule.check(files)), []);
});

test('project synchronization owns formal manifest replacement', () => {
  const legal = architectureFixtures({
    'src/stores/project.store.ts': 'export function useProjectStore() {}',
    'src/orchestrators/project-sync.orchestrator.ts':
      "import {useProjectStore} from '@/stores/project.store'; const project=useProjectStore(); project.replaceProjectManifest(manifest, 1);",
  });
  assert.deepEqual(messages(projectSessionBoundaryRule.check(legal)), []);
  const invalid = architectureFixtures({
    'src/stores/project.store.ts': 'export function useProjectStore() {}',
    'src/orchestrators/example.orchestrator.ts':
      "import {useProjectStore} from '@/stores/project.store'; const project=useProjectStore(); project.replaceProjectManifest(manifest, 1);",
  });
  assert.equal(messages(projectSessionBoundaryRule.check(invalid)).length, 1);
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
    assert.equal(messages(projectSessionBoundaryRule.check(files)).length, 1);
  });

test('workspace derives active project projection through the manifest owner', () => {
  const files = architectureFixtures({
    'src/stores/project.store.ts': 'export function useProjectStore() {}',
    'src/stores/workspace.store.ts':
      "import { useProjectStore } from '@/stores/project.store'; const activeManifest = computed(() => useProjectStore().getManifest(root));",
  });
  assert.deepEqual(messages(projectSessionBoundaryRule.check(files)), []);
});

test('active project fields belong to workspace', () => {
  const files = architectureFixtures({ 'src/stores/project.store.ts': 'const activeSessionId = computed(() => null);' });
  assert.equal(messages(projectSessionBoundaryRule.check(files)).length, 1);
});

for (const store of ['project', 'workspace', 'settings'])
  test('Core receives a root instead of reading ' + store, () => {
    const files = architectureFixtures({
      'src/orchestrators/core-assets.orchestrator.ts': `import type { State } from '@/stores/${store}.store';`,
      [`src/stores/${store}.store.ts`]: 'export interface State {}',
    });
    assert.equal(messages(projectSessionBoundaryRule.check(files)).length, 1);
  });

test('Core accepts the explicit reactive root supplied by its window', () => {
  const files = architectureFixtures({
    'src/orchestrators/core-assets.orchestrator.ts':
      "import type { Ref } from 'vue'; export function startCoreAssetsLoading(root: Readonly<Ref<string | null>>) { return () => {}; }",
  });
  assert.deepEqual(messages(projectSessionBoundaryRule.check(files)), []);
});
