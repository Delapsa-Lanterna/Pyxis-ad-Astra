import { defineRule } from '../../diagnostics.mjs';

const allowedServiceEdges = new Set([
  'app_lifecycle -> windows',
  'app_lifecycle -> project',
  'app_lifecycle -> project_sync',
  'app_lifecycle -> app_log',
  'app_lifecycle -> file_history',
  'app_lifecycle -> performance_monitor',
  'app_config -> system_open',
  'app_log -> app_settings',
  'app_log -> system_open',
  'app_settings -> workspace_persistence',
  'project_session -> app_settings',
  'project_session -> project',
  'project_sync -> windows',
  'project_sync -> project',
  'file_editor -> project',
  'config_entity -> project',
  'json_file -> project',
  'misc_config -> project',
  'windows -> project',
  'directory_opening -> project',
  'mod_creation -> project',
  'write_transactions -> app_settings',
  'write_transactions -> file_history',
  'write_transactions -> project',
  'project_save -> project',
  'project_save -> project_sync',
  'project_save -> write_transactions',
  'project_save -> file_editor',
  'project_save -> config_entity',
  'project_save -> json_file',
  'project_save -> misc_config',
  'json_file -> config_entity',
]);

export const rustServiceEdgeBoundaryRule = defineRule(
  'rust-service-edge-boundary',
  '.zcode/overview.md#Rust',
  import.meta.url,
  (context, report) => {
    for (const file of context.rust) {
      const from = topLevelServiceModule(file.rel);
      if (!from) continue;
      const rejected = new Set();
      for (const edge of file.rust.references) {
        const parts = edge.target;
        if (parts[0] !== 'services' || parts.length < 2) continue;
        const to = parts[1];
        if (to === from || allowedServiceEdges.has(from + ' -> ' + to) || rejected.has(to)) continue;
        report(file, edge, 'backend service ' + from + ' must not depend on service ' + to, {
          target: 'crate::' + parts.join('::'),
          expected: from,
        });
        rejected.add(to);
      }
    }
  },
);

/** @param {string} rel @returns {string | null} */
function topLevelServiceModule(rel) {
  const match = /^src-tauri\/src\/services\/([^/]+?)(?:\.rs|\/)/.exec(rel);
  if (!match) return null;
  return ['project', 'mod'].includes(/** @type {string} */ (match[1])) ? null : /** @type {string} */ (match[1]);
}
