import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../testing/fixtures.mjs';
import { commandBoundaryRule } from './command-boundary.mjs';
import { COMMAND_TRANSPORT, commandOwners, saveActionOwners } from './command-policy.mjs';

const provider = 'export function invokeCommand() {}';
const imports = [
  "import { invokeCommand as run } from '@/shared/runtime/command.runtime'; run('read_settings');",
  "import * as wire from '@/shared/runtime/command.runtime'; wire.invokeCommand('read_settings');",
  "import { invokeCommand } from '@/shared/runtime/command.runtime'; const run = invokeCommand; run('read_settings');",
  "import { run } from '@/shared/command-bridge'; run('read_settings');",
  "const wire = await import('@/shared/runtime/command.runtime'); wire.invokeCommand('read_settings');",
  "(await import('@/shared/runtime/command.runtime')).invokeCommand('read_settings');",
  "const { invokeCommand: run } = await import('@/shared/runtime/command.runtime'); run('read_settings');",
];

for (const [index, source] of imports.entries()) {
  test(`command source form ${index + 1} retains ownership and location`, () => {
    const files = architectureFixtures({
      [COMMAND_TRANSPORT]: provider,
      'src/shared/command-bridge.ts': "export { invokeCommand as run } from '@/shared/runtime/command.runtime';",
      'src/services/app-settings.service.ts': source,
      'src/services/example.service.ts': source,
    });
    const failures = commandBoundaryRule.check(files);
    assert.equal(failures.length, 1);
    const markers = ['run(', 'wire.invokeCommand(', 'run(', 'run(', 'wire.invokeCommand(', '(await ', 'run('];
    assert.deepEqual(
      { ...failures[0], message: undefined },
      {
        ruleId: 'command-boundary',
        reference: commandBoundaryRule.reference,
        source: commandBoundaryRule.source,
        file: 'src/services/example.service.ts',
        line: 1,
        column: source.indexOf(markers[index]) + 1,
        target: COMMAND_TRANSPORT,
        symbol: 'read_settings',
        expected: 'src/services/app-settings.service.ts',
        message: undefined,
      },
    );
    assert.match(failures[0].message, /read_settings: command must be owned/);
  });
}

test('computed commands require declared protocol facts', () => {
  const files = architectureFixtures({
    [COMMAND_TRANSPORT]: provider,
    'src/services/app-settings.service.ts': "import { invokeCommand } from '@/shared/runtime/command.runtime'; invokeCommand(name);",
  });
  assert.equal(messages(commandBoundaryRule.check(files)).length, 1);
});

test('ordered save transport retains command ownership through aliases and re-exports', () => {
  const files = architectureFixtures({
    [COMMAND_TRANSPORT]: 'export function invokeSaveCommand() {}',
    'src/shared/save-bridge.ts': "export { invokeSaveCommand as save } from '@/shared/runtime/command.runtime';",
    'src/services/spec-editor.service.ts': "import { save } from '@/shared/save-bridge'; save('save_editor_spec');",
    'src/services/example.service.ts':
      "import * as wire from '@/shared/runtime/command.runtime'; const save=wire.invokeSaveCommand; save('save_editor_spec');",
  });
  const failures = commandBoundaryRule.check(files);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].file, 'src/services/example.service.ts');
  assert.equal(failures[0].symbol, 'save_editor_spec');
});

test('scoped aliases and shadowed parameters retain their lexical ownership', () => {
  const source =
    "import { invokeCommand } from '@/shared/runtime/command.runtime'; function local(invokeCommand) { invokeCommand('save_settings'); } function actual() { const run = invokeCommand; run('read_settings'); }";
  const files = architectureFixtures({ [COMMAND_TRANSPORT]: provider, 'src/services/example.service.ts': source });
  const failures = messages(commandBoundaryRule.check(files));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /read_settings/);
});

test('every declared command has exactly one capability owner', () => {
  const commands = Object.values(commandOwners).flat();
  assert.ok(commands.length > 0);
  assert.equal(new Set(commands).size, commands.length);
});

test('native calls and saved actions each use their own declared transport', () => {
  const context = architectureFixtures({
    [COMMAND_TRANSPORT]: 'export function invokeCommand() {} export function invokeSaveCommand() {}',
    'src/services/spec-editor.service.ts': `import {invokeCommand, invokeSaveCommand} from '@/shared/runtime/command.runtime';
invokeCommand('save_editor_spec'); invokeSaveCommand('load_imported_editor_spec_file');`,
  });
  assert.deepEqual(
    commandBoundaryRule.check(context).map(({ symbol }) => symbol),
    ['save_editor_spec', 'load_imported_editor_spec_file'],
  );
  const actions = Object.values(saveActionOwners).flat();
  assert.equal(actions.length, 20);
  assert.equal(new Set(actions).size, actions.length);
  assert.equal(actions.filter((action) => Object.values(commandOwners).flat().includes(action)).length, 0);
});
