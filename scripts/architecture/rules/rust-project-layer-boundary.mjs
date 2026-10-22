import { rustFile } from '../../shared/files.mjs';
import { modulePartsFromRel, rustServiceExports, rustServicePaths } from '../../shared/rust-crate-paths.mjs';
import { productionRustSource } from '../../shared/rust-source.mjs';

/** @typedef {'commands' | 'service-assembly' | 'session-entry' | 'project-query' | 'project-write' | 'project-resources' | 'project-cache' | 'project-sources' | 'project-session' | 'project-model' | 'project-root' | 'file-history' | 'services' | 'domain' | 'io' | 'parsers' | 'models' | 'other'} RustLayer */

export const rustProjectLayerBoundaryRule = {
  name: 'rust-project-layer-boundary',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    const failures = [];
    const exports = rustServiceExports(files);
    for (const file of files) {
      if (!rustFile(file.rel)) continue;
      if (testOnlyRustFile(file.text)) continue;
      const productionText = productionRustSource(file.text);
      const from = rustLayer(file.rel);
      const modulePath = modulePartsFromRel(file.rel);
      const writeSource = modulePath.slice(0, 3).join('::') === 'services::project::write' ? modulePath[3] : null;
      const rejected = new Set();
      let payloadRejected = false;
      for (const edge of rustServicePaths(productionText, file.rel, exports)) {
        const parts = edge.target;
        const reference = `crate::${parts.join('::')}`;
        const to =
          from === 'commands' && edge.exported
            ? 'services'
            : from === 'services' && edge.exported
              ? 'project-root'
              : rustLayerFromCratePath(reference);
        if (!to) continue;
        const writeTarget = parts.slice(0, 3).join('::') === 'services::project::write' ? parts[3] : null;
        const descriptionBackEdge = writeSource === 'entity_description' && writeTarget === 'entity_identity';
        const stagingBackEdge = writeSource === 'csv_staging' && writeTarget && writeTarget !== 'csv_staging';
        if ((descriptionBackEdge || stagingBackEdge) && !rejected.has('csv-staging')) {
          failures.push(`${file.rel}: CSV draft and staging dependencies must stay one-way (${reference})`);
          rejected.add('csv-staging');
        }
        if (from !== 'commands' && from !== 'models' && parts[0] === 'models' && reference.endsWith('Payload')) {
          if (!payloadRejected) failures.push(`${file.rel}: command payload models must stay inside Rust command modules`);
          payloadRejected = true;
          continue;
        }
        const settingsRuntime =
          modulePath.join('::') === 'commands::app_lifecycle' && reference === 'crate::services::file_history::set_history_limit';
        const monitorRuntime =
          modulePath.join('::') === 'services::project::performance' && parts.slice(0, 2).join('::') === 'services::performance_monitor';
        if (!settingsRuntime && !monitorRuntime && !validRustDependency(from, to)) {
          if (!rejected.has(to)) failures.push(`${file.rel}: ${from} must not depend on ${to} (${reference})`);
          rejected.add(to);
        }
      }
      if (from === 'project-query' && writesToDisk(productionText)) {
        failures.push(`${file.rel}: project query code must not write files or apply changesets`);
      }
      if (from === 'project-write' && /ProjectManifest|open_project_session/.test(productionText)) {
        failures.push(`${file.rel}: project write code must not perform project session opening`);
      }
      if (from === 'project-cache' && /load_core_references|load_all_core|core_references/i.test(productionText)) {
        failures.push(`${file.rel}: project cache must stay typed lazy and must not pre-read the full core set`);
      }
      if (from === 'project-root' && /\bpub\s+mod\b/.test(productionText)) {
        failures.push(`${file.rel}: project root module must not expose internal submodules`);
      }
      if (from === 'services' && /\bpub\s+fn\s+\w+\([^)]*\b[A-Za-z0-9_]*Payload\b/.test(productionText)) {
        failures.push(`${file.rel}: service functions must not accept command payload models`);
      }
    }
    return failures;
  },
};

/** @param {string} path @returns {RustLayer} */
function rustLayer(path) {
  if (modulePartsFromRel(path).join('::') === 'services') return 'service-assembly';
  if (projectServiceModule(path, 'mod')) return 'session-entry';
  if (/^src-tauri\/src\/services\/file_history(?:\.rs|\/)/.test(path)) return 'file-history';
  if (path.startsWith('src-tauri/src/commands/')) return 'commands';
  if (path.startsWith('src-tauri/src/services/project/query/')) return 'project-query';
  if (path.startsWith('src-tauri/src/services/project/write/')) return 'project-write';
  if (path.startsWith('src-tauri/src/services/project/resources/')) return 'project-resources';
  if (path.startsWith('src-tauri/src/services/project/cache/')) return 'project-cache';
  if (path.startsWith('src-tauri/src/services/project/sources/')) return 'project-sources';
  if (path.startsWith('src-tauri/src/services/project/definitions/')) return 'project-root';
  if (projectServiceModule(path, 'session')) return 'project-session';
  if (projectServiceModule(path, 'model')) return 'project-model';
  if (/^src-tauri\/src\/services\/project\/[^/]+\.rs$/.test(path)) return 'project-root';
  if (path.startsWith('src-tauri/src/services/')) return 'services';
  if (path.startsWith('src-tauri/src/domain/')) return 'domain';
  if (path.startsWith('src-tauri/src/io/')) return 'io';
  if (path.startsWith('src-tauri/src/parsers/')) return 'parsers';
  if (path.startsWith('src-tauri/src/models/')) return 'models';
  return 'other';
}

/** @param {string} text @returns {boolean} */
function testOnlyRustFile(text) {
  const trimmed = text.trimStart();
  return trimmed.startsWith('#[cfg(test)]') || trimmed.startsWith('#![cfg(test)]');
}

/** @param {string} path @returns {RustLayer | null} */
function rustLayerFromCratePath(path) {
  if (path.startsWith('crate::services::file_history')) return 'file-history';
  if (path.startsWith('crate::commands')) return 'commands';
  if (path === 'crate::services::project::query' || path.startsWith('crate::services::project::query::')) return 'project-query';
  if (path === 'crate::services::project::write' || path.startsWith('crate::services::project::write::')) return 'project-write';
  if (path === 'crate::services::project::resources' || path.startsWith('crate::services::project::resources::'))
    return 'project-resources';
  if (path === 'crate::services::project::cache' || path.startsWith('crate::services::project::cache::')) return 'project-cache';
  if (path === 'crate::services::project::sources' || path.startsWith('crate::services::project::sources::')) return 'project-sources';
  if (path === 'crate::services::project::session' || path.startsWith('crate::services::project::session::')) return 'project-session';
  if (path === 'crate::services::project::model' || path.startsWith('crate::services::project::model::')) return 'project-model';
  if (path === 'crate::services::project' || path.startsWith('crate::services::project::')) return 'project-root';
  if (path.startsWith('crate::services')) return 'services';
  if (path.startsWith('crate::domain')) return 'domain';
  if (path.startsWith('crate::io')) return 'io';
  if (path.startsWith('crate::parsers')) return 'parsers';
  if (path.startsWith('crate::models')) return 'models';
  return null;
}

/** @param {string} path @param {string} moduleName @returns {boolean} */
function projectServiceModule(path, moduleName) {
  return new RegExp(`^src-tauri/src/services/project/${moduleName}(?:\\.rs|/)`).test(path);
}

/** @param {RustLayer} from @param {RustLayer} to @returns {boolean} */
function validRustDependency(from, to) {
  if (from === to) return true;
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

/** @param {string} text @returns {boolean} */
function writesToDisk(text) {
  return /\bwrite_|remove_|rename_|create_dir|apply_file_change_set|save_/.test(text);
}
