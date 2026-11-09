import { test } from 'node:test';
import { architectureFixtures, messages } from '../../../testing/fixtures.mjs';
import assert from 'node:assert/strict';
import { feedbackBoundaryRule } from './feedback-boundary.mjs';

test('settings and log declarations have separate owners and share the type barrel', () => {
  const files = architectureFixtures({
    'src/shared/types/app-settings.types.ts': 'export interface AppSettings {}',
    'src/shared/types/app-log.types.ts': 'export interface AppLogEntry {}',
    'src/shared/types/index.ts':
      "export type { AppSettings } from './app-settings.types'; export type { AppLogEntry } from './app-log.types';",
  });
  assert.deepEqual(messages(feedbackBoundaryRule.check(files)), []);
  const mixed = architectureFixtures({
    'src/shared/types/mixed.types.ts': 'export interface AppSettings {} export interface AppLogEntry {}',
  });
  assert.equal(messages(feedbackBoundaryRule.check(mixed)).length, 1);
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
    assert.equal(messages(feedbackBoundaryRule.check(files)).length, Number(name.startsWith('AppSettings')));
  }
});

test('aliased log type imports retain the actual settings type origin', () => {
  const context = architectureFixtures({
    'src/services/app-log.service.ts': 'import type {AppSettings as Config} from "@/shared/settings-bridge";',
    'src/shared/settings-bridge.ts': 'export type {AppSettings as Config} from "./types/app-settings.types";',
    'src/shared/types/app-settings.types.ts': 'export interface AppSettings{}',
    'src/shared/types/app-log.types.ts': 'export interface AppLogEntry{}',
  });
  assert.equal(messages(feedbackBoundaryRule.check(context)).length, 1);
});

for (const source of ['src/app/app-feedback.ts', 'src/app/composables/use-app-feedback.ts']) {
  for (const target of [
    'src/services/text-editor.service.ts',
    'src/stores/project.store.ts',
    'src/windows/text-editor.window.ts',
    'src/orchestrators/text-editor-window.orchestrator.ts',
    'src/app/app-feedback-assembly.ts',
  ])
    for (const typeOnly of [false, true])
      test(source + ' keeps recovery at assembly: ' + target + ' type=' + typeOnly, () => {
        const files = architectureFixtures({
          [source]: 'import ' + (typeOnly ? 'type ' : '') + "{ Value } from '@/" + target.slice(4, -3) + "';",
          [target]: 'export interface Value {}',
        });
        assert.equal(messages(feedbackBoundaryRule.check(files)).length, 1);
      });
}

test('feedback presentation consumes shared diagnostics, UI providers and the existing log capability', () => {
  const files = architectureFixtures({
    'src/app/app-feedback.ts':
      "import { h } from 'vue'; import { NButton } from 'naive-ui/es/button'; import { AppError } from '@/shared/lib/errors'; import { recordLogBestEffort } from '@/services/app-log.service';",
    'src/shared/lib/errors.ts': 'export class AppError {}',
    'src/services/app-log.service.ts': 'export function recordLogBestEffort() {}',
  });
  assert.deepEqual(messages(feedbackBoundaryRule.check(files)), []);
});
