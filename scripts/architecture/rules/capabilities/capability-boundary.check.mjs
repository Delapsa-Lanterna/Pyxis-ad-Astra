import { test } from 'node:test';
import { architectureFixtures, messages } from '../../testing/fixtures.mjs';
import assert from 'node:assert/strict';
import { capabilityBoundaryRule } from './capability-boundary.mjs';

test('file commands use the service capability boundary', () => {
  for (const owner of ['src/services/text-file-editing.service.ts', 'src/shared/wire.ts']) {
    const files = architectureFixtures({
      [owner]: "import { invokeCommand } from '@/shared/runtime/command.runtime'; invokeCommand('load_text_file');",
      'src/shared/runtime/command.runtime.ts': 'export function invokeCommand() {}',
    });
    assert.equal(messages(capabilityBoundaryRule.check(files)).length, Number(owner.startsWith('src/shared/')));
  }
});

test('joint edit submission is owned by its orchestrator and registration by its lifecycle', () => {
  const files = architectureFixtures({
    'src/orchestrators/joint-edit.orchestrator.ts': "import {saveJointEdit} from '@/services/joint-edit.service'; saveJointEdit(payload);",
    'src/app/composables/use-edit-target-handoff.ts':
      "import {updateEditTargetRegistration} from '@/services/window.service'; updateEditTargetRegistration(targets);",
    'src/services/joint-edit.service.ts': 'export function saveJointEdit(payload) {return payload;}',
    'src/services/window.service.ts': 'export function updateEditTargetRegistration(targets) {return targets;}',
  });
  assert.deepEqual(messages(capabilityBoundaryRule.check(files)), []);
});

test('immersive projections and window identity capabilities retain their declared owners', () => {
  const files = architectureFixtures({
    'src/app/composables/immersive-editor/use-immersive-editor-runtime.ts':
      "import {queryJointEditPreview} from '@/services/joint-edit.service'; queryJointEditPreview(draft);",
    'src/orchestrators/immersive-editor.orchestrator.ts':
      "import {focusNativeManagedWindow,retargetNativeWindow} from '@/services/window.service'; focusNativeManagedWindow(identity); retargetNativeWindow(identity,title);",
    'src/services/joint-edit.service.ts': 'export const queryJointEditPreview=(draft)=>draft;',
    'src/services/window.service.ts':
      'export const focusNativeManagedWindow=(identity)=>identity; export const retargetNativeWindow=(identity,title)=>({identity,title});',
  });
  assert.deepEqual(messages(capabilityBoundaryRule.check(files)), []);
});

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

test('runtime exports at protected providers declare their capability contract', () => {
  const files = architectureFixtures({ 'src/services/csv-table.service.ts': 'export function writeExtra() {}' });
  const message = messages(capabilityBoundaryRule.check(files))[0];
  assert.ok(message);
  assert.match(message, /writeExtra: public runtime exports must declare/);
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
