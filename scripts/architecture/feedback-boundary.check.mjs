import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { feedbackBoundaryRule } from './rules/feedback-boundary.mjs';
import { writeBoundaryRule } from './rules/write-boundary.mjs';

test('settings and log declarations have separate owners and share the type barrel', () => {
  const files = architectureFixtures({
    'src/shared/types/app-settings.types.ts': 'export interface AppSettings {}',
    'src/shared/types/app-log.types.ts': 'export interface AppLogEntry {}',
    'src/shared/types/index.ts':
      "export type { AppSettings } from './app-settings.types'; export type { AppLogEntry } from './app-log.types';",
  });
  assert.deepEqual(feedbackBoundaryRule.check(files), []);
  const mixed = architectureFixtures({
    'src/shared/types/mixed.types.ts': 'export interface AppSettings {} export interface AppLogEntry {}',
  });
  assert.equal(feedbackBoundaryRule.check(mixed).length, 1);
});

test('log service consumes log types and keeps settings persistence at its owner', () => {
  for (const name of ['AppLogEntry', 'AppSettings as Config']) {
    const files = architectureFixtures({
      'src/services/app-log.service.ts': `import type { ${name} } from '@/shared/types';`,
      'src/shared/types/index.ts':
        "export type { AppSettings } from './app-settings.types'; export type { AppLogEntry } from './app-log.types';",
      'src/shared/types/app-settings.types.ts': 'export interface AppSettings {}',
      'src/shared/types/app-log.types.ts': 'export interface AppLogEntry {}',
    });
    assert.equal(feedbackBoundaryRule.check(files).length, Number(name.startsWith('AppSettings')));
  }
});

test('file commands use the service capability boundary', () => {
  for (const owner of ['src/services/files.service.ts', 'src/shared/wire.ts']) {
    const files = architectureFixtures({
      [owner]: "import { invokeCommand } from '@/shared/runtime/command.runtime'; invokeCommand('load_editable_file');",
      'src/shared/runtime/command.runtime.ts': 'export function invokeCommand() {}',
    });
    assert.equal(writeBoundaryRule.check(files).length, Number(owner.startsWith('src/shared/')));
  }
});

for (const source of ['src/app/app-feedback.ts', 'src/app/composables/use-app-feedback.ts']) {
  for (const target of [
    'src/services/files.service.ts',
    'src/stores/project.store.ts',
    'src/windows/file-editor.window.ts',
    'src/orchestrators/file-editor-window.orchestrator.ts',
    'src/app/app-feedback-assembly.ts',
  ])
    for (const typeOnly of [false, true])
      test(source + ' keeps recovery at assembly: ' + target + ' type=' + typeOnly, () => {
        const files = architectureFixtures({
          [source]: 'import ' + (typeOnly ? 'type ' : '') + "{ Value } from '@/" + target.slice(4, -3) + "';",
          [target]: 'export interface Value {}',
        });
        assert.equal(feedbackBoundaryRule.check(files).length, 1);
      });
}
test('feedback presentation consumes shared diagnostics, UI providers and the existing log capability', () => {
  const files = architectureFixtures({
    'src/app/app-feedback.ts':
      "import { h } from 'vue'; import { NButton } from 'naive-ui/es/button'; import { AppError } from '@/shared/lib/errors'; import { recordLogBestEffort } from '@/services/app-log.service';",
    'src/shared/lib/errors.ts': 'export class AppError {}',
    'src/services/app-log.service.ts': 'export function recordLogBestEffort() {}',
  });
  assert.deepEqual(feedbackBoundaryRule.check(files), []);
});
