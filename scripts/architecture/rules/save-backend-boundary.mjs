import { rustCommandModule } from '../../shared/files.mjs';
import { rustServiceExports, rustServicePaths } from '../../shared/rust-crate-paths.mjs';
import { productionRustSource } from '../../shared/rust-source.mjs';

const commandServices = new Map([
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

export const saveBackendBoundaryRule = {
  name: 'save-backend-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    const exports = rustServiceExports(files);
    for (const file of files) {
      if (!rustCommandModule(file.rel)) continue;
      const source = productionRustSource(file.text);
      const declarations = [...source.matchAll(/\bpub\s+fn\s+(\w+)\s*\(/g)];
      const imports = source.slice(0, declarations[0]?.index ?? source.length);
      for (const [index, declaration] of declarations.entries()) {
        const owner = commandServices.get(declaration[1]);
        if (!owner) continue;
        const command = imports + source.slice(declaration.index, declarations[index + 1]?.index ?? source.length);
        const allowed = new Set([owner, 'project', 'write_transactions']);
        for (const edge of rustServicePaths(command, file.rel, exports)) {
          const parts = edge.target;
          if (parts[0] === 'services' && parts.length > 1 && !allowed.has(parts[1])) {
            failures.push(file.rel + ': ' + declaration[1] + ' must consume its business backend (' + parts.join('::') + ')');
          }
        }
      }
    }
    return failures;
  },
};
