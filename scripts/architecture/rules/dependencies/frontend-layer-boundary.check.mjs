import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frontendLayerBoundaryRule } from './frontend-layer-boundary.mjs';
import { messages, architectureFixtures } from '../../testing/fixtures.mjs';

test('extensionless relative and alias imports reveal an orchestrator cycle', () => {
  const files = architectureFixtures({
    'src/orchestrators/alpha.orchestrator.ts': "import { beta } from '@/orchestrators/beta.orchestrator'; export function alpha() {}",
    'src/orchestrators/beta.orchestrator.ts': "import { alpha } from './alpha.orchestrator'; export function beta() {}",
  });
  assert.equal(messages(frontendLayerBoundaryRule.check(files)).filter((failure) => failure.includes('dependency cycle')).length, 1);
});

test('one-way runtime and type imports keep the dependency graph acyclic', () => {
  const files = architectureFixtures({
    'src/orchestrators/alpha.orchestrator.ts': "import { beta, type Beta } from './beta.orchestrator'; export interface Alpha {}",
    'src/orchestrators/beta.orchestrator.ts': 'export interface Beta {} export function beta() {}',
  });
  assert.deepEqual(messages(frontendLayerBoundaryRule.check(files)), []);
});

test('type cycles are checked across shared models and domain projections', () => {
  for (const directory of ['shared/types', 'domain/schema']) {
    const files = architectureFixtures({
      [`src/${directory}/alpha.ts`]: "import type { Beta } from './beta'; export interface Alpha {}",
      [`src/${directory}/beta.ts`]: "import type { Alpha } from './alpha'; export interface Beta {}",
    });
    assert.equal(messages(frontendLayerBoundaryRule.check(files)).length, 1);
  }
});

test('a mixed type import still participates in runtime cycle detection', () => {
  const files = architectureFixtures({
    'src/orchestrators/alpha.orchestrator.ts': "import { type Beta, beta } from './beta.orchestrator'; export function alpha() {}",
    'src/orchestrators/beta.orchestrator.ts':
      "import { alpha } from './alpha.orchestrator'; export interface Beta {} export function beta() {}",
  });
  assert.equal(messages(frontendLayerBoundaryRule.check(files)).length, 1);
});

test('component dependency rejection has one owner and one source-positioned diagnostic', () => {
  const files = architectureFixtures({
    'src/app/components/config/Audit.vue':
      '<script setup lang="ts">\nimport { saveCsvPatch, writeEditableFileText } from "@/services/csv-table.service";\n</script><template><div /></template>',
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {} export function writeEditableFileText() {}',
  });
  const failures = messages(frontendLayerBoundaryRule.check(files));
  assert.equal(failures.length, 1);
  assert.ok(failures[0]);
  assert.match(failures[0], /Audit.vue:2:\d+: src\/services\/csv-table.service.ts: components must consume/);
});

test('layer directions govern type imports and production capability constraints exempt test fixtures', () => {
  const files = architectureFixtures({
    'src/domain/sample.ts': "import type { State } from '@/stores/sample.store';",
    'src/stores/sample.store.ts': 'export interface State {}',
    'src/app/components/sample.spec.ts': "import { saveCsvPatch } from '@/services/csv-table.service';",
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
  });
  assert.equal(messages(frontendLayerBoundaryRule.check(files)).length, 1);
});

test('browser persistence access follows global bindings and preserves source locations', () => {
  const legal = architectureFixtures({
    'src/domain/sample.ts': 'function run(localStorage) { localStorage.getItem("value"); } const text="localStorage";',
  });
  assert.deepEqual(frontendLayerBoundaryRule.check(legal), []);
  const context = architectureFixtures({
    'src/domain/sample.ts': '\nconst disk=localStorage;\ndisk.getItem("value");\nglobalThis.indexedDB.open("value");',
  });
  const diagnostics = frontendLayerBoundaryRule.check(context);
  assert.deepEqual(
    diagnostics.map(({ line, column, symbol, expected }) => ({ line, column, symbol, expected })),
    [
      { line: 3, column: 1, symbol: 'localStorage', expected: 'app config services' },
      { line: 4, column: 1, symbol: 'indexedDB', expected: 'app config services' },
    ],
  );
});

test('window persistence access is treated as a global browser store', () => {
  const context = architectureFixtures({
    'src/app/composables/use-sample.ts': 'window.localStorage.setItem("workspace", "value");',
  });
  const [diagnostic] = frontendLayerBoundaryRule.check(context);
  assert.ok(diagnostic);
  assert.equal(diagnostic.symbol, 'localStorage');
  assert.equal(diagnostic.expected, 'app config services');
});
