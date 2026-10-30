import { defineRule } from '../../../diagnostics.mjs';

const coreCommands = new Set(['upload_sprite', 'scan_core_graphics', 'scan_core_fields']);
const entityBackends = new Set(['config_entity', 'json_file', 'spec_editor']);

export const projectResourcesBoundaryRule = defineRule(
  'project-resources-boundary',
  '.zcode/modules/core-assets.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.rust) {
      const [module] = /** @type {[string, ...string[]]} */ (file.rel.replace('src-tauri/src/services/', '').split(/[/.]/));
      if (entityBackends.has(module))
        for (const edge of file.rust.references)
          if (edge.target.at(-1) === 'ResourceRef')
            report(file, edge, 'config and spec backends must consume project resource behavior through its owner', {
              target: edge.target.join('::'),
              expected: 'Project Resources',
            });
      if (!file.rel.startsWith('src-tauri/src/commands/')) continue;
      for (const fn of file.rust.functions) {
        if (!coreCommands.has(fn.name)) continue;
        const targets = file.rust.references.filter((edge) => edge.offset >= fn.start && edge.offset < fn.end);
        if (!targets.some((edge) => edge.target.slice(0, 4).join('::') === 'services::project::resources::core_assets'))
          report(file, fn, 'Core asset commands must route to Project Resources', { symbol: fn.name, expected: 'Project Resources' });
        for (const edge of targets)
          if (edge.target.slice(0, 2).join('::') === 'services::schema')
            report(file, edge, 'Core asset commands must not route through Schema backend', {
              target: edge.target.join('::'),
              symbol: fn.name,
              expected: 'services::project::resources::core_assets',
            });
      }
    }
  },
);
