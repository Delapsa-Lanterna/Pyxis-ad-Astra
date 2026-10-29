import { defineRule } from '../../diagnostics.mjs';

const allowedServiceEdges = new Set([
  'app_config -> app_paths',
  'app_lifecycle -> windows',
  'app_lifecycle -> project',
  'app_lifecycle -> project_session',
  'app_lifecycle -> app_log',
  'app_lifecycle -> file_history',
  'app_lifecycle -> performance_monitor',
  'app_config -> system_open',
  'app_log -> app_paths',
  'app_log -> app_settings',
  'app_log -> system_open',
  'app_settings -> app_paths',
  'app_settings -> workspace_persistence',
  'performance_monitor -> app_paths',
  'project_session -> app_paths',
  'project_session -> app_settings',
  'project_session -> directory_opening',
  'project_session -> project',
  'project_session -> project_sync',
  'project_session -> write_transactions',
  'project_session -> windows',
  'project_sync -> windows',
  'file_editor -> project',
  'config_entity -> project',
  'json_file -> project',
  'misc_config -> project',
  'windows -> project',
  'mod_creation -> directory_opening',
  'workspace_persistence -> app_paths',
  'write_transactions -> app_settings',
  'write_transactions -> file_history',
  'write_transactions -> project',
  'write_transactions -> project_sync',
  'write_transactions -> file_editor',
  'write_transactions -> config_entity',
  'write_transactions -> json_file',
  'write_transactions -> misc_config',
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
  return ['project', 'mod'].includes(match[1]) ? null : match[1];
}
