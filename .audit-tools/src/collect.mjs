import { lstat, readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { execute, hash } from './runtime.mjs';

/** @param {string} root @returns {Promise<import('./model.mjs').AuditInputSnapshot>} */
export async function collect(root) {
  const listing = await execute('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root });
  const paths = [...new Set(listing.stdout.split('\0').filter(Boolean))]
    .filter((path) => !path.startsWith('.audit-tools/') && !path.startsWith('.zcode/plans/'))
    .sort();
  /** @type {import('./model.mjs').File[]} */
  const files = [];
  for (const path of paths) {
    const full = join(root, path);
    const info = await lstat(full).catch(
      /** @returns {null} */ (error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      },
    );
    if (!info || !info.isFile()) continue;
    const bytes = await readFile(full);
    let text = null;
    if (!bytes.includes(0)) {
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
      }
    }
    const role = /(?:\.spec\.|\.check\.|(?:^|\/)(?:test|tests|testdata|fixtures)(?:\/|\.rs)|_tests?\.rs$|testutil\.rs$)/.test(path)
      ? 'test'
      : path.endsWith('.md')
        ? 'document'
        : /^(src\/|src-tauri\/src\/)/.test(path) && /\.(?:vue|tsx?|jsx?|mjs|css|rs)$/.test(path)
          ? 'production'
          : /\.(?:png|jpe?g|ico|svg|woff2?|ttf|otf)$/.test(path)
            ? 'asset'
            : 'engineering';
    files.push({
      path,
      bytes: bytes.length,
      hash: hash(bytes),
      text,
      role,
      ownership: { status: 'unmatched', owner: null, candidates: [] },
      lines: text === null ? null : text.split('\n').length - Number(text.endsWith('\n')),
    });
  }
  const head = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  return { root, head, files, digest: hash(files.map((file) => file.path + '\0' + file.hash).join('\n')) };
}

/** @param {import('./model.mjs').File} file @returns {file is import('./model.mjs').File & {text: string}} */
export function isTextFile(file) {
  return file.text !== null;
}

/** @param {import('./model.mjs').File[]} files */
export function sharedFiles(files) {
  /** @type {Map<string, import('./model.mjs').Evidence[]>} */
  const shared = new Map();
  const map = files.find((file) => file.path === '.zcode/module-map.md');
  /** @type {{path: string, evidence: import('./model.mjs').Evidence}[]} */
  const declarations = [];
  let section = '';
  for (const [index, line] of (map?.text ?? '').split('\n').entries()) {
    if (line.startsWith('## ')) section = line.slice(3).trim();
    const match = /^- `([^`]+)`：(.+)/.exec(line);
    if (section === '公共文件' && match)
      declarations.push({
        path: /** @type {string} */ (match[1]).replace(/\/$/, ''),
        evidence: { path: '.zcode/module-map.md', line: index + 1, text: line, parser: 'shared-declaration' },
      });
  }
  for (const file of files) {
    const evidence = declarations
      .filter((entry) => file.path === entry.path || file.path.startsWith(entry.path + '/'))
      .map((entry) => entry.evidence);
    if (/(?:^|\/)shared\//.test(file.path))
      evidence.push({ path: file.path, line: 1, text: 'Shared directory', parser: 'shared-directory' });
    if (evidence.length) shared.set(file.path, evidence);
  }
  for (const file of files) {
    const paired = /\.spec\.[cm]?[jt]sx?$/.test(file.path)
      ? [file.path.replace(/\.spec(\.[cm]?[jt]sx?)$/, '$1'), file.path.replace(/\.spec\.[cm]?[jt]sx?$/, '.vue')]
      : /_tests?\.rs$/.test(file.path)
        ? [file.path.replace(/_tests?\.rs$/, '.rs')]
        : [];
    for (const source of paired)
      if (shared.has(source))
        shared.set(file.path, [
          ...(shared.get(source) ?? []),
          { path: source, line: 1, text: 'Shared colocated test: ' + file.path, parser: 'file-pair' },
        ]);
  }
  return shared;
}

/** @param {import('./model.mjs').AuditInputSnapshot} snapshot @returns {{modules: import('./model.mjs').Module[], issues: import('./model.mjs').Issue[]}} */
export function readModules(snapshot) {
  const paths = new Map(snapshot.files.map((file) => [file.path, file]));
  const mapPath = '.zcode/module-map.md';
  const map = paths.get(mapPath);
  if (!map?.text) throw new Error(`Module index missing: ${mapPath}`);
  /** @type {import('./model.mjs').Module[]} */
  const modules = [];
  /** @type {import('./model.mjs').Issue[]} */
  const issues = [];
  for (const [index, line] of map.text.split('\n').entries()) {
    const match = /^- \[([^\]]+)\]\(([^)]+\.md)\)/.exec(line);
    if (!match) continue;
    const [, title, document] = /** @type {RegExpExecArray & [string, string, string]} */ (match);
    const path = posix.normalize(posix.join(posix.dirname(mapPath), document));
    const file = paths.get(path);
    if (!file?.text) {
      issues.push({
        kind: 'module-document',
        path: mapPath,
        line: index + 1,
        message: `Missing module document: ${path}`,
        parser: 'module-document',
      });
      continue;
    }
    /** @type {Record<string, import('./model.mjs').ReferenceKind>} */
    const kinds = { 拥有: 'owns', 消费: 'consumes', 装配: 'assembles', 关联: 'related' };
    /** @type {import('./model.mjs').Module['references']} */
    const references = [];
    let section = '',
      group = '';
    for (const [row, text] of file.text.split(/\r?\n/).entries()) {
      if (text.startsWith('## ')) {
        section = text.slice(3).trim();
        group = '';
      }
      if (section !== '参考') continue;
      if (text.startsWith('### ')) group = text.slice(4).trim();
      const ref = /^- `([^`]+)`：(\S.*)/.exec(text);
      const kind = kinds[group];
      if (ref && kind) {
        const [, path, role] = /** @type {RegExpExecArray & [string, string, string]} */ (ref);
        references.push({ path: path.replace(/\/$/, ''), role, line: row + 1, kind });
      }
    }
    modules.push({ id: posix.basename(path, '.md'), title, path, references });
  }
  if (!modules.length) throw new Error(`No module declarations parsed from ${mapPath}`);
  return { modules, issues };
}

/** @param {import('./model.mjs').AuditInputSnapshot} before @param {import('./model.mjs').AuditInputSnapshot} after */
export function assertUnchanged(before, after) {
  if (before.digest === after.digest) return;
  const first = new Map(before.files.map((file) => [file.path, file.hash]));
  const last = new Map(after.files.map((file) => [file.path, file.hash]));
  const changed = [...new Set([...first.keys(), ...last.keys()])].filter((path) => first.get(path) !== last.get(path));
  throw new Error(`Source changed during scan:\n${changed.join('\n')}`);
}
