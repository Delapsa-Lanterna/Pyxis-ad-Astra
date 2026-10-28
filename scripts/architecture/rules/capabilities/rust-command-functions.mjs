import { defineRule } from '../../diagnostics.mjs';

export const rustCommandFunctionsRule = defineRule(
  'rust-command-functions',
  '.zcode/modules/backend-capabilities.md#规范',
  import.meta.url,
  (context, report) => {
    for (const file of context.rust) {
      if (!file.rel.startsWith('src-tauri/src/commands/')) continue;
      for (const fn of file.rust.functions) {
        if (fn.attributes.includes('command_macros::command')) continue;
        report(file, fn, 'commands functions must declare the unified command macro', {
          symbol: fn.name,
          expected: '#[command_macros::command]',
        });
      }
    }
  },
);
