import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ignoredDirs = new Set(['.git', 'dist', 'node_modules', 'release', 'target']);
const ignoredPathParts = ['src-tauri/gen', 'src-tauri/target'];

/** @typedef {{ path: string, rel: string }} RepoPath */
/** @typedef {RepoPath & { text: string }} SourceFile */

/**
 * Walks the repository once with the shared ignore rules and keeps the files
 * accepted by `include(rel, extension)`. Collection-scope differences between
 * entry scripts are expressed only through the predicate.
 *
 * @param {string} root
 * @param {(rel: string, extension: string) => boolean} include
 * @param {boolean} [includeDirectories]
 * @returns {Promise<RepoPath[]>}
 */
export async function collectRepoPaths(root, include, includeDirectories = false) {
  return collectPaths(root, root, include, includeDirectories);
}

/**
 * @param {string} root
 * @param {string} dir
 * @param {(rel: string, extension: string) => boolean} include
 * @param {boolean} includeDirectories
 * @returns {Promise<RepoPath[]>}
 */
async function collectPaths(root, dir, include, includeDirectories) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const rel = normalizePath(relative(root, path));
    if (rel === '.audit-tools') continue;
    if (entry.isDirectory()) {
      if (includeDirectories) files.push({ path, rel: rel + '/' });
      if (ignoredDirs.has(entry.name) || ignoredPathParts.some((part) => rel.startsWith(`${part}/`) || rel === part)) continue;
      files.push(...(await collectPaths(root, path, include, includeDirectories)));
      continue;
    }
    const extension = entry.name.includes('.') ? entry.name.slice(entry.name.lastIndexOf('.')) : '';
    if (include(rel, extension)) files.push({ path, rel });
  }
  return files;
}

/** @param {string} path @returns {string} */
function normalizePath(path) {
  return path.replace(/\\/g, '/');
}
