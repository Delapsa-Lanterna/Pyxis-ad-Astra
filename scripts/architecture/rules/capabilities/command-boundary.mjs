import { defineRule } from '../../diagnostics.mjs';
import { callsFrom } from '../../facts/imports.mjs';
import { COMMAND_TRANSPORT, commandOwners, saveActionOwners } from './command-policy.mjs';
import { commandTransportRoles } from '../../facts/command-transport.mjs';
import { commandRegistrations, commandParameters, commandArgumentTypes, commandArgumentKeys } from '../../facts/command-contract.mjs';

const transport = new Set([COMMAND_TRANSPORT]);

export const commandBoundaryRule = defineRule(
  'command-boundary',
  '.zcode/modules/backend-capabilities.md#权限判定',
  import.meta.url,
  (context, report) => {
    const entry = context.byPath.get('src-tauri/src/lib.rs');
    const commands = new Map();
    const properties = commandArgumentTypes(context);
    if (entry) {
      const registrations = commandRegistrations(entry);
      const names = new Set(registrations.map(({ name }) => name));
      const declarations = new Set();
      for (const file of context.rust.filter((file) => file.rel.startsWith('src-tauri/src/commands/'))) {
        for (const fn of file.rust.functions.filter((fn) => fn.attributes.includes('command_macros::command'))) {
          declarations.add(fn.name);
          if (!names.has(fn.name))
            report(file, fn, 'native command is missing from generate_handler!', {
              target: entry.rel,
              symbol: fn.name,
              expected: 'registered native command',
            });
          if (commands.has(fn.commandName))
            report(file, fn, 'native command wire names must be unique', { symbol: fn.commandName, expected: 'unique native command' });
          commands.set(fn.commandName, { file, fields: commandParameters(fn) });
        }
      }
      const seen = new Set();
      for (const at of registrations) {
        if (!declarations.has(at.name) || seen.has(at.name))
          report(entry, at, 'handler registration must resolve to one declared command', {
            symbol: at.name,
            expected: 'unique declared command',
          });
        seen.add(at.name);
      }
    }
    /** @param {import('../../facts/context.mjs').ArchitectureFile} file @param {import('typescript').CallExpression} node @param {import('../../diagnostics.mjs').Position} at @param {string} name */
    function checkArguments(file, node, at, name) {
      if (!entry) return;
      const command = commands.get(name);
      if (!command) {
        report(file, at, 'native command has no declaration', { symbol: name, target: entry.rel, expected: 'declared native command' });
        return;
      }
      const { keys, complete } = commandArgumentKeys(node.arguments[1], properties);
      const relation = { target: command.file.rel, symbol: name, expected: [...command.fields.keys()].join(', ') || 'no arguments' };
      for (const key of keys.keys())
        if (!command.fields.has(key)) report(file, at, 'unexpected top-level command argument ' + key, relation);
      for (const [key, required] of command.fields)
        if (required && complete && !keys.get(key)) report(file, at, 'missing required top-level command argument ' + key, relation);
    }
    const provider = context.byPath.get(COMMAND_TRANSPORT);
    const transports = commandTransportRoles(context, COMMAND_TRANSPORT, (node, name) => {
      if (!provider) return;
      const ast = node.getSourceFile(),
        at = ast.getLineAndCharacterOfPosition(node.getStart(ast));
      checkArguments(provider, node, { line: at.line + 1, column: at.character + 1 }, name);
    });
    for (const file of context.frontend) {
      if (file.rel === COMMAND_TRANSPORT) continue;
      for (const call of callsFrom(file, context.byPath, transport)) {
        if (!transports.has(call.name)) continue;
        const transportKind = transports.get(call.origin.name);
        if (!transportKind) continue;
        const command = call.arguments[0];
        const policy = transportKind === 'save' ? saveActionOwners : commandOwners;
        const owners = Object.entries(policy)
          .filter(([, commands]) => command != null && commands.includes(command))
          .map(([owner]) => owner);
        if (!owners.includes(file.rel))
          report(
            file,
            call,
            (command ?? 'computed command') + ': command must be owned by ' + (owners.join(', ') || 'a declared capability'),
            { target: COMMAND_TRANSPORT, symbol: command ?? 'computed command', expected: owners.join(', ') || 'declared capability' },
          );
        if (transportKind === 'command' && command) checkArguments(file, call.node, call, command);
      }
    }
  },
);
