import { defineRule } from '../../diagnostics.mjs';

const commandServices = new Map([
  ['save_misc_config', 'misc_config'],
  ['delete_misc_config', 'misc_config'],
  ['load_imported_editor_spec_file', 'spec_editor'],
  ['save_editor_spec', 'project'],
  ['save_csv_patch', 'project'],
  ['recreate_json_sources', 'project'],
  ['save_joint_edit', 'project'],
  ['synchronize_committed_write', 'write_transactions'],
  ['save_mod_info', 'config_entity'],
  ['save_indexed_config_entity', 'config_entity'],
  ['create_indexed_config_entity', 'config_entity'],
  ['delete_indexed_config_entity', 'config_entity'],
  ['save_variant_entity', 'project'],
  ['create_variant_entity', 'json_file'],
  ['delete_variant_entity', 'json_file'],
  ['save_skin_entity', 'json_file'],
  ['create_skin_entity', 'json_file'],
  ['delete_skin_entity', 'json_file'],
  ['load_editable_file', 'file_editor'],
  ['save_text_file', 'file_editor'],
  ['transcode_file_to_utf8', 'file_editor'],
  ['query_text_identity_intent', 'file_editor'],
  ['follow_text_identity', 'file_editor'],
  ['apply_file_change_set', 'write_transactions'],
  ['query_file_history', 'write_transactions'],
  ['clear_file_history', 'write_transactions'],
]);

export const saveBackendBoundaryRule = defineRule(
  'save-backend-boundary',
  '.zcode/modules/backend-capabilities.md#规范',
  import.meta.url,
  (context, report) => {
    for (const file of context.rust) {
      if (!file.rel.startsWith('src-tauri/src/commands/')) continue;
      for (const fn of file.rust.functions) {
        const owner = commandServices.get(fn.name);
        if (!owner) continue;
        const allowed = new Set([owner, 'project', 'write_transactions']);
        for (const edge of file.rust.references) {
          if (edge.offset < fn.start || edge.offset >= fn.end) continue;
          const parts = edge.target;
          if (parts[0] === 'services' && parts.length > 1 && !allowed.has(parts[1]))
            report(file, edge, fn.name + ' must consume its business backend', {
              target: parts.join('::'),
              symbol: fn.name,
              expected: owner,
            });
        }
      }
    }
  },
);
