import { test } from 'node:test';
import { architectureFixtures, messages } from '../../../testing/fixtures.mjs';
import assert from 'node:assert/strict';
import { projectSessionBoundaryRule } from './project-session-boundary.mjs';

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
  const files = architectureFixtures({
    'src/stores/project.store.ts':
      "import {defineStore} from 'pinia'; export const useProjectStore=defineStore('project',()=>{const activeSessionId=computed(()=>null);return {activeSessionId};});",
  });
  assert.equal(messages(projectSessionBoundaryRule.check(files)).length, 1);
});

test('local variables with project field names do not define project store ownership', () => {
  const files = architectureFixtures({
    'src/stores/project.store.ts':
      "import {defineStore} from 'pinia'; export const useProjectStore=defineStore('project',()=>{function read(){const activeSessionId=null;return activeSessionId;} return {read};});",
  });
  assert.deepEqual(messages(projectSessionBoundaryRule.check(files)), []);
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
