import { defineRule } from '../../diagnostics.mjs';
import { modulePartsFromRel } from '../../facts/rust-crate-paths.mjs';
import { rustLayer, rustLayerFromCratePath } from '../../facts/rust-classify.mjs';
/** @typedef {import('../../facts/rust-classify.mjs').RustLayer} RustLayer */

export const rustProjectLayerBoundaryRule = defineRule(
  'rust-project-layer-boundary',
  '.zcode/overview.md#Rust',
  import.meta.url,
  (context, report) => {
    for (const file of context.rust) {
      const from = rustLayer(file.rel);
      const modulePath = modulePartsFromRel(file.rel);
      const writeSource = modulePath.slice(0, 3).join('::') === 'services::project::write' ? modulePath[3] : null;
      const rejected = new Set();
      for (const edge of file.rust.references) {
        const parts = edge.target;
        const reference = 'crate::' + parts.join('::');
        const to =
          from === 'commands' && edge.exported
            ? 'services'
            : from === 'services' && edge.exported
              ? 'project-root'
              : rustLayerFromCratePath(reference);
        if (!to) continue;
        const writeTarget = parts.slice(0, 3).join('::') === 'services::project::write' ? parts[3] : null;
        if (
          (writeSource === 'entity_description' && writeTarget === 'entity_identity') ||
          (writeSource === 'csv_staging' && writeTarget && writeTarget !== 'csv_staging')
        ) {
          if (!rejected.has('csv-staging'))
            report(file, edge, 'CSV draft and staging dependencies must stay one-way', {
              target: reference,
              expected: 'shared CSV staging',
            });
          rejected.add('csv-staging');
        }
        if (from !== 'commands' && from !== 'models' && parts[0] === 'models' && reference.endsWith('Payload')) {
          if (!rejected.has('payload'))
            report(file, edge, 'command payload models must stay inside Rust command modules', {
              target: reference,
              expected: 'Rust command module',
            });
          rejected.add('payload');
          continue;
        }
        const runtimeSettings =
          modulePath.join('::') === 'commands::app_lifecycle' && reference === 'crate::services::file_history::set_history_limit';
        const runtimeMonitor =
          modulePath.join('::') === 'services::project::performance' && parts.slice(0, 2).join('::') === 'services::performance_monitor';
        const sessionAccess =
          ['project-query', 'project-write', 'project-resources'].includes(from) &&
          [
            'crate::services::project::session::lock_ready_session',
            'crate::services::project::session::session_handle',
            'crate::services::project::session::lock_session',
            'crate::services::project::session::lock_registry',
            'crate::services::project::session::references::reference_revision',
          ].includes(reference);
        if (!runtimeSettings && !runtimeMonitor && !sessionAccess && !validRustDependency(from, to) && !rejected.has(to)) {
          report(file, edge, from + ' must not depend on ' + to, { target: reference, expected: from });
          rejected.add(to);
        }
        if (from === 'project-query' && parts[0] === 'io' && /^(?:write_|remove_|rename_|create_dir|apply_|save_)/.test(parts.at(-1) ?? ''))
          report(file, edge, 'project query code must consume read-only IO', { target: reference, expected: 'read-only IO' });
      }
      if (
        from === 'project-query' &&
        /\b(?:remove_file|write|write_all|rename|create|create_dir|create_dir_all|OpenOptions)\s*\(/.test(file.rust.code)
      )
        report(file, { line: 1, column: 1 }, 'project query code must consume read-only IO', {
          target: 'std::fs',
          expected: 'read-only IO',
        });
      if (from === 'project-write' && /\b(?:ProjectManifest|open_project_session)\w*\s*\(/.test(file.rust.code))
        report(file, { line: 1, column: 1 }, 'project write code must not perform project session opening', {
          target: 'crate::services::project::session',
          expected: 'write-only project service',
        });
      if (from === 'project-cache') {
        const reportedCoreLoads = new Set();
        for (const edge of file.rust.references)
          if (
            /^(?:load_core_references|load_all_core|load_core_catalog|read_all_core)/i.test(edge.target.at(-1) ?? '') &&
            !reportedCoreLoads.has(edge.target.join('::'))
          ) {
            reportedCoreLoads.add(edge.target.join('::'));
            report(file, edge, 'project cache must stay typed lazy and must not pre-read the full core set', {
              target: edge.target.join('::'),
              symbol: edge.target.at(-1),
              expected: 'typed lazy core query',
            });
          }
      }
      if (from === 'services')
        for (const fn of file.rust.functions)
          if (/\b[A-Za-z0-9_]*Payload\b/.test(fn.signature))
            report(file, fn, 'service functions must not accept command payload models', {
              symbol: fn.name,
              expected: 'service-owned parameter types',
            });
      if (from === 'project-root' && /\bpub\s+mod\b/.test(file.rust.code))
        report(file, { line: 1, column: 1 }, 'project root module must keep internal submodules private');
    }
  },
);

/** @param {RustLayer} from @param {RustLayer} to @returns {boolean} */
function validRustDependency(from, to) {
  if (from === to) return true;
  if (from === 'shared') return false;
  if (to === 'shared') return true;
  if (to === 'app-data-dir') return ['services', 'session-entry'].includes(from);
  if (from === 'app-data-dir') return to === 'models';
  if (to === 'project-sources')
    return [
      'session-entry',
      'project-query',
      'project-write',
      'project-resources',
      'project-cache',
      'project-session',
      'project-root',
    ].includes(from);
  if (from === 'project-sources') return ['project-model', 'domain', 'io', 'parsers', 'models'].includes(to);
  if (from === 'service-assembly') return ['services', 'project-query', 'project-write', 'project-resources'].includes(to);
  if (from === 'session-entry') return ['project-session', 'project-cache', 'project-root'].includes(to);
  if (from === 'commands') return ['services', 'project-root', 'models'].includes(to);
  if (from === 'file-history') return ['io', 'models'].includes(to);
  if (from === 'project-query')
    return ['project-model', 'project-cache', 'project-root', 'project-resources', 'domain', 'io', 'parsers', 'models'].includes(to);
  if (from === 'project-write')
    return ['project-model', 'project-cache', 'project-query', 'project-root', 'domain', 'io', 'parsers', 'models'].includes(to);
  if (from === 'project-resources') return ['project-model', 'project-cache', 'domain', 'io', 'parsers', 'models', 'services'].includes(to);
  if (from === 'project-cache') return ['project-model', 'domain', 'io', 'parsers', 'models'].includes(to);
  if (from === 'project-session')
    return ['project-model', 'project-cache', 'project-root', 'file-history', 'domain', 'io', 'parsers', 'models'].includes(to);
  if (from === 'project-model') return ['domain', 'models'].includes(to);
  if (from === 'project-root')
    return ['project-cache', 'project-resources', 'project-model', 'domain', 'io', 'parsers', 'models'].includes(to);
  if (from === 'services') return ['services', 'file-history', 'project-root', 'domain', 'io', 'parsers', 'models'].includes(to);
  if (from === 'domain') return to === 'domain' || to === 'models';
  if (from === 'io') return to === 'io' || to === 'parsers' || to === 'models';
  if (from === 'parsers') return to === 'parsers' || to === 'models';
  if (from === 'models') return to === 'models';
  return true;
}
