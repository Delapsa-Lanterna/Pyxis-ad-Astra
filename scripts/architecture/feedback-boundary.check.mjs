import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { feedbackBoundaryRule } from './rules/feedback-boundary.mjs';
import { writeBoundaryRule } from './rules/write-boundary.mjs';

test('settings and log declarations have separate owners and share the type barrel', () => {
  const files = architectureFixtures({
    'src/shared/types/settings.types.ts': 'export interface AppSettings {}',
    'src/shared/types/app-log.types.ts': 'export interface AppLogEntry {}',
    'src/shared/types/index.ts': "export type { AppSettings } from './settings.types'; export type { AppLogEntry } from './app-log.types';",
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
        "export type { AppSettings } from './settings.types'; export type { AppLogEntry } from './app-log.types';",
      'src/shared/types/settings.types.ts': 'export interface AppSettings {}',
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
