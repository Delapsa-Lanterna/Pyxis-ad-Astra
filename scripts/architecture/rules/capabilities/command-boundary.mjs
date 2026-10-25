import { defineRule } from '../../diagnostics.mjs';
import { callsFrom } from '../../facts/imports.mjs';
import { COMMAND_TRANSPORT, commandOwners } from './command-policy.mjs';

const transport = new Set([COMMAND_TRANSPORT]);

export const commandBoundaryRule = defineRule(
  'command-boundary',
  '.zcode/modules/backend-capabilities.md#权限判定',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      if (file.rel === COMMAND_TRANSPORT) continue;
      for (const call of callsFrom(file, context.byPath, transport)) {
        if (call.name !== 'invokeCommand') continue;
        const command = call.arguments[0];
        const owners = Object.entries(commandOwners)
          .filter(([, commands]) => command != null && commands.includes(command))
          .map(([owner]) => owner);
        if (!owners.includes(file.rel))
          report(
            file,
            call,
            (command ?? 'computed command') + ': command must be owned by ' + (owners.join(', ') || 'a declared capability'),
            { target: COMMAND_TRANSPORT, symbol: command ?? 'computed command', expected: owners.join(', ') || 'declared capability' },
          );
      }
    }
  },
);
