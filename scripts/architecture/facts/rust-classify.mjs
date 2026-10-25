import { modulePartsFromRel } from './rust-crate-paths.mjs';

/** @typedef {'commands' | 'service-assembly' | 'session-entry' | 'project-query' | 'project-write' | 'project-resources' | 'project-cache' | 'project-sources' | 'project-session' | 'project-model' | 'project-root' | 'file-history' | 'services' | 'domain' | 'io' | 'parsers' | 'models' | 'other'} RustLayer */

/** @param {string} path @returns {RustLayer} */
export function rustLayer(path) {
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

/** @param {string} path @returns {RustLayer | null} */
export function rustLayerFromCratePath(path) {
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
