import { defineRule } from '../../diagnostics.mjs';
import { frontendFile, specFile } from '../../facts/classify.mjs';
import { callsFrom } from '../../facts/imports.mjs';

const suffixes = new Map([
  ['services', ['.service.ts']],
  ['stores', ['.store.ts']],
  ['orchestrators', ['.orchestrator.ts']],
  ['windows', ['.window.ts', '.events.ts']],
]);

export const namingBoundaryRule = defineRule(
  'naming-boundary',
  '.zcode/frontend-guidelines.md#类型与分支设计',
  import.meta.url,
  (context, report) => {
    for (const file of context.files) {
      if (!frontendFile(file.rel) || specFile(file.rel)) continue;
      const suffix = suffixes.get(file.role.layer);
      if (file.rel.endsWith('.vue')) {
        const component = file.rel.split('/').at(-1)?.slice(0, -4) ?? '';
        if (!/^[A-Z][A-Za-z0-9]*$/.test(component))
          report(file, { line: 1, column: 1 }, 'Vue component files must use PascalCase', {
            symbol: component,
            expected: 'PascalCase component name',
          });
      }
      if (suffix && !suffix.some((ending) => file.rel.endsWith(ending)))
        report(file, { line: 1, column: 1 }, file.role.layer + ' files must use ' + suffix.join(' or '));
      if (file.role.layer === 'domain' && /\.(service|store|orchestrator)\.ts$/.test(file.rel))
        report(file, { line: 1, column: 1 }, 'domain files must express their domain responsibility');
      for (const call of callsFrom(file, context.byPath, new Set(['pinia']))) {
        const id = call.arguments[0];
        if (call.name === 'defineStore' && id && !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id))
          report(file, call, 'Pinia store id must use kebab-case', { symbol: id });
      }
      for (const event of file.frontend.events)
        if (!event.name.startsWith('update:') && /[A-Z]/.test(event.name))
          report(file, event, 'emitted events must use kebab-case', { symbol: event.name });
    }
  },
);
