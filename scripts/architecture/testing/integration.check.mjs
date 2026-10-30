import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from './fixtures.mjs';

import { capabilityBoundaryRule } from '../rules/capabilities/capability-boundary.mjs';
import { frontendLayerBoundaryRule } from '../rules/dependencies/frontend-layer-boundary.mjs';

import { rules } from '../registry.mjs';

test('a ViewModel may observe a cache while project invalidation has its own owner', () => {
  const files = architectureFixtures({
    'src/app/composables/use-sample.ts':
      "import { subscribeQueryInvalidations, invalidateQueryCacheByProject } from '@/services/query-cache.service';",
    'src/services/query-cache.service.ts':
      'export function subscribeQueryInvalidations() {} export function invalidateQueryCacheByProject() {}',
  });
  const failures = messages(capabilityBoundaryRule.check(files));
  assert.equal(failures.length, 1);
  assert.ok(failures[0]);
  assert.match(failures[0], /project-cache-invalidate \(invalidateQueryCacheByProject\).*orchestrators\/project-sync/);
});

test('the close boundary owns session cleanup and the refresh boundary owns project invalidation', () => {
  const files = architectureFixtures({
    'src/orchestrators/project-sync.orchestrator.ts': "import { invalidateQueryCacheForSession } from '@/services/query-cache.service';",
    'src/orchestrators/workspace-lifecycle.orchestrator.ts':
      "import { invalidateQueryCacheByProject } from '@/services/query-cache.service';",
    'src/services/query-cache.service.ts':
      'export function invalidateQueryCacheForSession() {} export function invalidateQueryCacheByProject() {}',
  });
  assert.equal(messages(capabilityBoundaryRule.check(files)).length, 2);
});

test('explicit and extensionless imports reject the same capability once', () => {
  for (const suffix of ['', '.ts']) {
    const files = architectureFixtures({
      'src/windows/audit.window.ts': `import { saveCsvPatch } from '@/services/csv-table.service${suffix}'; import { saveSpecEditorSpec } from '@/services/spec-editor.service${suffix}';`,
      'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
      'src/services/spec-editor.service.ts': 'export function saveSpecEditorSpec() {}',
    });
    const failures = messages(capabilityBoundaryRule.check(files));
    assert.equal(failures.length, 2);
    assert.equal(failures.filter((failure) => failure.includes('table-write')).length, 1);
    assert.equal(failures.filter((failure) => failure.includes('spec-write')).length, 1);
  }
});

test('protected namespace, export-star and dynamic module consumption retain capability authorization', () => {
  for (const source of [
    "import * as hidden from '@/shared/bridge';",
    "const hidden = import('@/shared/bridge');",
    "import { patch } from '@/shared/bridge';",
  ]) {
    const files = architectureFixtures({
      'src/app/composables/use-sample.ts': source,
      'src/shared/bridge.ts':
        "export * from '@/services/csv-table.service'; export { saveCsvPatch as patch } from '@/services/csv-table.service';",
      'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
    });
    const diagnostics = capabilityBoundaryRule.check(files).filter((diagnostic) => diagnostic.file === 'src/app/composables/use-sample.ts');
    assert.equal(diagnostics.length, 1);
  }
});

test('an imported alias in a forwarding module retains its original symbol permission', () => {
  const files = architectureFixtures({
    'src/app/composables/use-sample.ts': "import { submit } from '@/shared/bridge';",
    'src/shared/bridge.ts': "import { saveCsvPatch as patch } from '@/services/csv-table.service'; export const submit = patch;",
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
  });
  const message = messages(capabilityBoundaryRule.check(files))[0];
  assert.ok(message);
  assert.match(message, /table-write \(saveCsvPatch\)/);
});

test('file history public aliases form their formal capability boundary', () => {
  const files = architectureFixtures({
    'src/app/composables/use-sample.ts': "import { loadFileHistory } from '@/services/file-history.service';",
    'src/services/file-history.service.ts': 'export function loadFileHistory() {}',
  });
  assert.deepEqual(messages(capabilityBoundaryRule.check(files)), []);
});

test('independent layer and capability violations each produce a diagnostic', () => {
  const files = architectureFixtures({
    'src/app/components/editors/Audit.vue':
      '<script setup lang="ts">import { saveCsvPatch } from "@/services/csv-table.service";</script><template><div /></template>',
    'src/services/csv-table.service.ts': 'export function saveCsvPatch() {}',
  });
  const failures = rules
    .flatMap((rule) => messages(rule.check(files)))
    .filter((failure) => failure.includes('Audit.vue') && (failure.includes('components must') || failure.includes('table-write')));
  assert.equal(failures.length, 2);
});

test('runtime exports at protected providers declare their capability contract', () => {
  const files = architectureFixtures({ 'src/services/csv-table.service.ts': 'export function writeExtra() {}' });
  const message = messages(capabilityBoundaryRule.check(files))[0];
  assert.ok(message);
  assert.match(message, /writeExtra: public runtime exports must declare/);
});

test('production fixture consumption has one diagnostic and tests may consume production', () => {
  for (const source of [
    "import { fixture } from '@/test/fixtures/entity-target';",
    "import type { Fixture } from '@/test/fixtures/entity-target';",
  ]) {
    const files = architectureFixtures({
      'src/domain/example.ts': source,
      'src/test/fixtures/entity-target.ts': 'export interface Fixture {} export function fixture() {}',
    });
    const failures = rules.flatMap((rule) => messages(rule.check(files))).filter((failure) => failure.includes('src/domain/example.ts'));
    assert.equal(failures.length, 1);
    assert.ok(failures[0]);
    assert.match(failures[0], /domain must not import test/);
  }
  const files = architectureFixtures({
    'src/domain/example.spec.ts': "import { example } from './example';",
    'src/domain/example.ts': 'export function example() {}',
  });
  assert.deepEqual(
    rules.flatMap((rule) => messages(rule.check(files))).filter((failure) => failure.includes('src/domain/example.spec.ts')),
    [],
  );
});

test('feedback construction has one owner for direct and forwarded runtime imports', () => {
  for (const source of [
    "import { useMessage, useDialog } from 'naive-ui'; useMessage(); useDialog();",
    "import * as feedback from '@/shared/feedback-bridge';",
    "const feedback = import('@/shared/feedback-bridge');",
  ]) {
    const files = architectureFixtures({
      'src/app/composables/use-sample.ts': source,
      'src/shared/feedback-bridge.ts': "export * from 'naive-ui';",
    });
    assert.equal(
      rules.flatMap((rule) => messages(rule.check(files))).filter((failure) => failure.includes('src/app/composables/use-sample.ts'))
        .length,
      1,
    );
  }
});

test('invoke aliases and namespace imports remain wire capabilities', () => {
  for (const source of ["import { invoke as send } from '@tauri-apps/api/core';", "import * as core from '@tauri-apps/api/core';"]) {
    const files = architectureFixtures({ 'src/windows/audit.window.ts': source });
    assert.equal([...messages(frontendLayerBoundaryRule.check(files)), ...messages(capabilityBoundaryRule.check(files))].length, 1);
    const message = messages(capabilityBoundaryRule.check(files))[0];
    assert.ok(message);
    assert.match(message, /invoke-wire/);
  }
  const files = architectureFixtures({
    'src/app/composables/use-sample.ts': "import { send } from '@/shared/runtime/bridge';",
    'src/shared/runtime/bridge.ts': "export { invoke as send } from '@tauri-apps/api/core';",
  });
  const message = messages(capabilityBoundaryRule.check(files))[0];
  assert.ok(message);
  assert.match(message, /invoke-wire/);
});

test('the window assembly consumes the feedback factory through its declared capability', () => {
  const files = architectureFixtures({
    'src/app/app-feedback.ts': 'export function createAppFeedback() {}',
    'src/app/app-feedback-assembly.ts': "import { createAppFeedback } from '@/app/app-feedback';",
    'src/app/WindowRuntime.vue':
      "<script setup>import { useMessage } from 'naive-ui/es/message'; import { useDialog } from 'naive-ui/es/dialog';</script>",
    'src/app/composables/use-sample.ts': "import { createAppFeedback } from '@/app/app-feedback';",
  });
  assert.equal(messages(capabilityBoundaryRule.check(files)).length, 1);
  const message = messages(capabilityBoundaryRule.check(files))[0];
  assert.ok(message);
  assert.match(message, /feedback-factory/);
});

test('a pure domain with the same semantic name retains its own ownership', () => {
  const files = architectureFixtures({
    'src/domain/app-feedback.ts': 'export function createAppFeedback() {}',
    'src/domain/consumer.ts': "import { createAppFeedback } from './app-feedback';",
  });
  assert.deepEqual(messages(capabilityBoundaryRule.check(files)), []);
});

test('command-domain purity retains both layer and capability obligations', () => {
  const files = architectureFixtures({
    'src/domain/workspace/commands.ts':
      "import { querySessionEntity } from '@/services/entity-query.service'; export function shortcutCommandFromKeyEvent() {}",
    'src/services/entity-query.service.ts': 'export function querySessionEntity() {}',
  });
  assert.equal(
    rules.flatMap((rule) => messages(rule.check(files))).filter((failure) => failure.includes('src/domain/workspace/commands.ts')).length,
    2,
  );
});

test('window settings consumption is constrained through the actual settings capability module', () => {
  const files = architectureFixtures({
    'src/windows/audit.window.ts': "import { readSettings } from '@/services/app-settings.service';",
    'src/services/app-settings.service.ts': 'export function readSettings() {}',
  });
  const failures = rules
    .flatMap((rule) => messages(rule.check(files)))
    .filter((failure) => failure.includes('src/windows/audit.window.ts'));
  assert.equal(failures.length, 1);
  assert.ok(failures[0]);
  assert.match(failures[0], /settings-read/);
});
