import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ignore from 'ignore';

/** @typedef {{ path: string, rel: string }} RepoPath */
/** @typedef {RepoPath & { text: string }} SourceFile */
/** @typedef {{root: string, rules: import('ignore').Ignore}} IgnoreScope */

/**
 * Walks the repository once with directory-scoped Git ignore rules and keeps the files
 * accepted by `include(rel, extension)`. Collection-scope differences between
 * entry scripts are expressed only through the predicate.
 *
 * @param {string} root
 * @param {(rel: string, extension: string) => boolean} include
 * @param {boolean} [includeDirectories]
 * @returns {Promise<RepoPath[]>}
 */
export async function collectRepoPaths(root, include, includeDirectories = false) {
  return collectPaths(root, root, include, includeDirectories, []);
}

/**
 * @param {string} root
 * @param {string} dir
 * @param {(rel: string, extension: string) => boolean} include
 * @param {boolean} includeDirectories
 * @param {IgnoreScope[]} scopes
 * @returns {Promise<RepoPath[]>}
 */
async function collectPaths(root, dir, include, includeDirectories, scopes) {
  const entries = await readdir(dir, { withFileTypes: true });
  if (entries.some((entry) => entry.name === '.gitignore' && entry.isFile()))
    scopes = [...scopes, { root: dir, rules: ignore.default().add(await readFile(join(dir, '.gitignore'), 'utf8')) }];
  const files = [];
  for (const entry of entries) {
    // Git metadata and the independent audit workspace remain outside the application checks.
    if (entry.name === '.git' || (dir === root && entry.name === '.audit-tools')) continue;
    const path = join(dir, entry.name);
    const directory = entry.isDirectory();
    const ignored = scopes.reduce((excluded, scope) => {
      const match = scope.rules.test(normalizePath(relative(scope.root, path)) + (directory ? '/' : ''));
      return match.ignored || (!match.unignored && excluded);
    }, false);
    if (ignored) continue;
    const rel = normalizePath(relative(root, path));
    if (directory) {
      if (includeDirectories) files.push({ path, rel: rel + '/' });
      files.push(...(await collectPaths(root, path, include, includeDirectories, scopes)));
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

/** @param {string} rel @returns {string[]} */
export function pairedSourcePaths(rel) {
  if (/\.(?:spec|test|check)\.[cm]?[jt]sx?$/.test(rel)) {
    const stem = rel.replace(/\.(?:spec|test|check)\.[cm]?[jt]sx?$/, '');
    const extension = rel.slice(rel.lastIndexOf('.'));
    return [stem + extension, stem + '.vue', ...(extension === '.mjs' ? [stem + '.js'] : [])];
  }
  return /_tests?\.rs$/.test(rel) ? [rel.replace(/_tests?\.rs$/, '.rs')] : [];
}
