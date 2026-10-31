import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { directoryOpeningBoundaryRule } from './directory-opening-boundary.mjs';

for (const command of ['detect_directory', 'scan_game_overview'])
  test(command + ' routes to its actual backend', () => {
    const valid = architectureFixtures({
      'src-tauri/src/commands/sample.rs':
        'use crate::services::directory_opening as opening;\npub fn ' + command + '() { opening::run(); }',
    });
    assert.deepEqual(directoryOpeningBoundaryRule.check(valid), []);
    const invalid = architectureFixtures({
      'src-tauri/src/commands/sample.rs': 'use crate::services::file_editor as files;\npub fn ' + command + '() { files::run(); }',
    });
    const diagnostics = directoryOpeningBoundaryRule.check(invalid);
    assert.equal(diagnostics.length, 1);
    assert.ok(diagnostics[0]);
    assert.equal(diagnostics[0].ruleId, 'directory-opening-boundary');
    assert.equal(diagnostics[0].line, 2);
    assert.equal(diagnostics[0].symbol, command);
    assert.equal(diagnostics[0].expected, 'services::directory_opening');
  });

test('Directory Opening wire models stay in their model module', () => {
  const invalid = architectureFixtures({
    'src-tauri/src/models/project.rs': 'pub struct OpenDirectoryResult { pub root: String }',
  });
  const [diagnostic] = directoryOpeningBoundaryRule.check(invalid);
  assert.ok(diagnostic);
  assert.equal(diagnostic.symbol, 'OpenDirectoryResult');
  assert.equal(diagnostic.expected, 'src-tauri/src/models/directory_opening.rs');
});

test('directory readers and notice lists accept explicit input while workspace owns lifecycle', () => {
  for (const file of ['src/services/directory.service.ts', 'src/app/components/ModOpeningFailureList.vue']) {
    const body = "import {useWorkspaceStore} from '@/stores/workspace.store';";
    const source = file.endsWith('.vue') ? '<script setup>' + body + '</script>' : body;
    const context = architectureFixtures({ [file]: source, 'src/stores/workspace.store.ts': 'export function useWorkspaceStore() {}' });
    const [diagnostic] = directoryOpeningBoundaryRule.check(context);
    assert.ok(diagnostic);
    assert.equal(diagnostic.target, 'src/stores/workspace.store.ts');
  }
});
