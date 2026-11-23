import { test } from 'node:test';
import { architectureFixtures, messages } from '../../testing/fixtures.mjs';
import { COMMAND_TRANSPORT, saveActionOwners, commandOwners } from './command-policy.mjs';
import { commandBoundaryRule } from './command-boundary.mjs';
import assert from 'node:assert/strict';

const imports = [
  "import { invokeCommand as run } from '@/shared/runtime/command.runtime'; run('read_settings');",
  "import * as wire from '@/shared/runtime/command.runtime'; wire.invokeCommand('read_settings');",
  "import { invokeCommand } from '@/shared/runtime/command.runtime'; const run = invokeCommand; run('read_settings');",
  "import { run } from '@/shared/command-bridge'; run('read_settings');",
  "const wire = await import('@/shared/runtime/command.runtime'); wire.invokeCommand('read_settings');",
  "(await import('@/shared/runtime/command.runtime')).invokeCommand('read_settings');",
  "const { invokeCommand: run } = await import('@/shared/runtime/command.runtime'); run('read_settings');",
];

const provider =
  "import { invoke as nativeInvoke } from '@tauri-apps/api/core'; export function invokeCommand(command,args){return nativeInvoke(command,args);}";

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
    const marker = markers[index];
    assert.ok(marker);
    assert.deepEqual(
      { ...failures[0], message: undefined },
      {
        ruleId: 'command-boundary',
        reference: commandBoundaryRule.reference,
        source: commandBoundaryRule.source,
        file: 'src/services/example.service.ts',
        line: 1,
        column: source.indexOf(marker) + 1,
        target: COMMAND_TRANSPORT,
        symbol: 'read_settings',
        expected: 'src/services/app-settings.service.ts',
        message: undefined,
      },
    );
    assert.ok(failures[0]);
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
    [COMMAND_TRANSPORT]: provider + " export function invokeSaveCommand(action,args){return invokeCommand('save_project',{action,args});}",
    'src/shared/save-bridge.ts': "export { invokeSaveCommand as save } from '@/shared/runtime/command.runtime';",
    'src/services/spec-editor.service.ts': "import { save } from '@/shared/save-bridge'; save('save_editor_spec');",
    'src/services/example.service.ts':
      "import * as wire from '@/shared/runtime/command.runtime'; const save=wire.invokeSaveCommand; save('save_editor_spec');",
  });
  const failures = commandBoundaryRule.check(files);
  assert.equal(failures.length, 1);
  assert.ok(failures[0]);
  assert.equal(failures[0].file, 'src/services/example.service.ts');
  assert.equal(failures[0].symbol, 'save_editor_spec');
});

test('scoped aliases and shadowed parameters retain their lexical ownership', () => {
  const source =
    "import { invokeCommand } from '@/shared/runtime/command.runtime'; function local(invokeCommand) { invokeCommand('save_settings'); } function actual() { const run = invokeCommand; run('read_settings'); }";
  const files = architectureFixtures({ [COMMAND_TRANSPORT]: provider, 'src/services/example.service.ts': source });
  const failures = messages(commandBoundaryRule.check(files));
  assert.equal(failures.length, 1);
  assert.ok(failures[0]);
  assert.match(failures[0], /read_settings/);
});

test('native calls and saved actions each use their own declared transport', () => {
  const context = architectureFixtures({
    [COMMAND_TRANSPORT]: provider + " export function invokeSaveCommand(action,args){return invokeCommand('save_project',{action,args});}",
    'src/services/spec-editor.service.ts': `import {invokeCommand, invokeSaveCommand} from '@/shared/runtime/command.runtime';
invokeCommand('save_editor_spec'); invokeSaveCommand('load_imported_editor_spec_file');`,
  });
  assert.deepEqual(
    commandBoundaryRule.check(context).map(({ symbol }) => symbol),
    ['save_editor_spec', 'load_imported_editor_spec_file'],
  );
  const actions = Object.values(saveActionOwners).flat();
  assert.equal(actions.length, 23);
  assert.deepEqual(saveActionOwners['src/services/java-project.service.ts'], ['deploy_java_artifact']);
  assert.equal(new Set(actions).size, actions.length);
  assert.equal(actions.filter((action) => Object.values(commandOwners).flat().includes(action)).length, 0);
});

test('renaming internal transport functions preserves command ownership', () => {
  const context = architectureFixtures({
    [COMMAND_TRANSPORT]:
      "import {invoke as send} from '@tauri-apps/api/core';export function transfer(command,args){return send(command,args);}",
    'src/services/app-settings.service.ts': "import {transfer as wire} from '@/shared/runtime/command.runtime';wire('read_settings');",
    'src/services/example.service.ts': "import {transfer as wire} from '@/shared/runtime/command.runtime';wire('read_settings');",
  });
  const diagnostics = commandBoundaryRule.check(context);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.file, 'src/services/example.service.ts');
});

test('joint commands have a single capability owner and reject a second payload surface', () => {
  const files = architectureFixtures({
    'src/services/joint-edit.service.ts':
      "import {invokeCommand} from '@/shared/runtime/command.runtime'; export const read=(payload)=>invokeCommand('query_joint_edit',{payload});",
    'src/services/spec-editor.service.ts':
      "import {invokeCommand} from '@/shared/runtime/command.runtime'; export const read=(payload)=>invokeCommand('query_joint_edit',{payload});",
    'src/shared/runtime/command.runtime.ts':
      "import {invoke} from '@tauri-apps/api/core'; export function invokeCommand(command,args){return invoke(command,args);}",
  });
  const failures = messages(commandBoundaryRule.check(files));
  assert.equal(failures.length, 1);
  assert.ok(failures[0]);
  assert.ok(failures[0].includes('src/services/spec-editor.service.ts'));
});

const service = 'src/services/java-analysis.service.ts';
const commandFile = 'src-tauri/src/commands/java_analysis.rs';
const entry = 'src-tauri/src/lib.rs';
const declaration =
  '#[command_macros::command(rename = "subscribe_java_analysis")]\npub fn subscribe(app: AppHandle, view: WebviewWindow, subscription_key: String, optional_value: Option<u32>, channel: Channel<Snapshot>) -> AppResult<()> {}';
const client = "import {invokeCommand as run} from '@/shared/runtime/command.runtime';\n";
/** @param {string} call @param {string} [commands] @param {string} [handlers] */
function contract(call, commands = declaration, handlers = 'commands::subscribe') {
  return commandBoundaryRule.check(
    architectureFixtures({
      [entry]: 'command_macros::generate_handler![' + handlers + ']',
      [commandFile]: commands,
      [COMMAND_TRANSPORT]: provider,
      [service]: client + call,
      'src/shared/options.ts': 'export interface Subscription { subscriptionKey:string; channel:object; optionalValue?:number }',
    }),
  );
}
test('matches registered Rust names, explicit wire renames, injected context and channel arguments', () => {
  assert.deepEqual(contract("run('subscribe_java_analysis', {subscriptionKey:'a',channel,optionalValue:null});"), []);
  assert.deepEqual(contract("run('subscribe_java_analysis', {subscriptionKey:'a',channel});"), []);
  const errors = contract("run('subscribe_java_analysis', {subscriptionId:'a',channel});");
  assert.deepEqual(
    errors.map(({ file, line, column, message }) => [file, line, column, message]),
    [
      [service, 2, 1, 'unexpected top-level command argument subscriptionId'],
      [service, 2, 1, 'missing required top-level command argument subscriptionKey'],
    ],
  );
});
test('handler entries are unique and have matching command declarations', () => {
  const errors = contract('', declaration, 'commands::removed, commands::removed');
  assert.deepEqual(
    errors.map(({ file, symbol }) => [file, symbol]),
    [
      [commandFile, 'subscribe'],
      [entry, 'removed'],
      [entry, 'removed'],
    ],
  );
  assert.equal(contract('', declaration, 'commands::subscribe, commands::subscribe').length, 1);
  assert.equal(contract("run('subscribe_java_analysis');", '', '')[0]?.message, 'native command has no declaration');
});
test('resolves typed argument spreads from imported interfaces', () => {
  const typed =
    "import type {Subscription} from '@/shared/options';\ndeclare const args:Subscription;\nrun('subscribe_java_analysis', {...args});";
  assert.deepEqual(contract(typed), []);
  const errors = contract(typed, declaration.replace('subscription_key: String', 'operation: String'));
  assert.deepEqual(
    errors.map(({ message }) => message),
    ['unexpected top-level command argument subscriptionKey', 'missing required top-level command argument operation'],
  );
  assert.equal(
    contract(typed, declaration.replace('Option<u32>', 'u32'))[0]?.message,
    'missing required top-level command argument optionalValue',
  );
});
test('honors snake-case parameters and the transport-owned save envelope', () => {
  const action = declaration.replace('rename = "subscribe_java_analysis"', 'rename = "subscribe_java_analysis", rename_all = "snake_case"');
  assert.deepEqual(contract("run('subscribe_java_analysis',{subscription_key:'a',channel});", action), []);
  const errors = commandBoundaryRule.check(
    architectureFixtures({
      [entry]: 'command_macros::generate_handler![commands::save_project]',
      [commandFile]: '#[command_macros::command] pub fn save_project(request: Request) {}',
      [COMMAND_TRANSPORT]:
        provider + " export function invokeSaveCommand(action,args){return invokeCommand('save_project',{payload:args});}",
    }),
  );
  assert.deepEqual(
    errors.map(({ message }) => message),
    ['unexpected top-level command argument payload', 'missing required top-level command argument request'],
  );
});

test('keeps conditional object keys and reports known typos alongside an open spread', () => {
  const choices =
    "declare const args: {channel: object, subscriptionKey: string} | {channel: object, subscriptionId: string}; run('subscribe_java_analysis', args);";
  assert.deepEqual(
    contract(choices).map(({ message }) => message),
    ['unexpected top-level command argument subscriptionId', 'missing required top-level command argument subscriptionKey'],
  );
  const open = "declare const options:Record<string,unknown>; run('subscribe_java_analysis',{...options, typo:true});";
  assert.deepEqual(
    contract(open).map(({ message }) => message),
    ['unexpected top-level command argument typo'],
  );
});
