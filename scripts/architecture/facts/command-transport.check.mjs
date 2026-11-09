import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../testing/fixtures.mjs';
import { commandTransportRoles } from './command-transport.mjs';

test('transport roles follow calls to the external IPC implementation after internal renames', () => {
  const context = architectureFixtures({
    'src/shared/runtime/command.runtime.ts': `
      import { invoke as wire } from '@tauri-apps/api/core';
      export function send(command, args) { return wire(command, args); }
      export function commit(action, args) { return send('save_project', { action, args }); }
    `,
  });
  assert.deepEqual(
    [...commandTransportRoles(context, 'src/shared/runtime/command.runtime.ts')],
    [
      ['send', 'command'],
      ['commit', 'save'],
    ],
  );
});

test('local same-named functions do not acquire external transport roles', () => {
  const context = architectureFixtures({
    'src/shared/runtime/command.runtime.ts': 'export function send(command) { return command; }',
  });
  assert.deepEqual(commandTransportRoles(context, 'src/shared/runtime/command.runtime.ts'), new Map());
});
