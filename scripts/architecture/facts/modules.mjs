/** @typedef {{path: string, group: string, line: number}} ModuleReference */
/** @typedef {{lines: string[], headings: {name: string, index: number}[], references: ModuleReference[], styleLines: number[]}} ModuleFacts */

/** @param {string} text @returns {ModuleFacts} */
export function moduleFacts(text) {
  const lines = text.split(/\r?\n/);
  const headings = [];
  const references = [];
  const styleLines = [];
  let section = '';
  let group = '';
  for (const [index, line] of lines.entries()) {
    if (line.startsWith('## ')) {
      section = line.slice(3);
      group = '';
      headings.push({ name: section, index });
    } else if (line.startsWith('### ')) group = line.slice(4);
    if (/\bcss\b/i.test(line)) styleLines.push(index + 1);
    const reference = section === '参考' ? /^- `([^`]+)`：/.exec(line) : null;
    if (reference) references.push({ path: reference[1], group, line: index + 1 });
  }
  return { lines, headings, references, styleLines };
}

const MODULE_DIRECTORY = '.zcode/modules/';
const MODULE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

/** @param {readonly import('./context.mjs').ArchitectureFile[]} files @param {ReadonlySet<string>} paths */
export function moduleMapFacts(files, paths) {
  /** @type {Map<string, string[]>} */
  const descendants = new Map();
  for (const path of paths) {
    const rel = path.replace(/\/$/, '');
    const parts = rel.split('/');
    for (let length = 1; length <= parts.length; length++) {
      const parent = parts.slice(0, length).join('/');
      const children = descendants.get(parent) ?? [];
      children.push(rel);
      descendants.set(parent, children);
    }
  }
  const map = files.find((file) => file.rel === '.zcode/module-map.md');
  /** @type {import('../../shared/frontend-source.mjs').SourceFailure[]} */
  const failures = [];
  /** @param {number} line @param {string} message */
  const report = (line, message) => failures.push({ line, column: 1, message });
  if (!map)
    return {
      descendants,
      index: new Map(),
      shared: new Set(),
      failures: [{ line: 1, column: 1, message: 'module map index file is missing' }],
    };
  return { descendants, index: readModuleIndex(map, report), shared: readSharedPaths(map, paths, report), failures };
}

/** @param {import('./context.mjs').ArchitectureFile} map @param {ReadonlySet<string>} paths @param {(line: number, message: string) => void} report */
function readSharedPaths(map, paths, report) {
  const shared = new Set([...paths].filter((path) => /(?:^|\/)shared\//.test(path)));
  let section = '',
    previous = '';
  for (const [index, line] of map.document.lines.entries()) {
    if (line.startsWith('## ')) section = line.slice(3);
    if (section !== '公共文件' || !line || line.startsWith('## ')) continue;
    const match = /^- `([^`]+)`：(\S.*)$/.exec(line);
    if (
      !match ||
      /[\\:*?"<>|]/.test(match[1]) ||
      match[1].split('/').some((part, i, all) => (!part && i !== all.length - 1) || part === '.' || part === '..')
    ) {
      report(index + 1, `public files require a literal path and responsibility`);
      continue;
    }
    const target = match[1].replace(/\/$/, '');
    if (!paths.has(target) && !paths.has(target + '/')) report(index + 1, `public path does not exist: ${target}`);
    if (previous && previous >= target) report(index + 1, `public paths must be unique and sorted`);
    previous = target;
    for (const path of paths) if (path === target || path.startsWith(target + '/')) shared.add(path.replace(/\/$/, ''));
  }
  for (const path of paths) {
    const paired = /\.spec\.[cm]?[jt]sx?$/.test(path)
      ? [path.replace(/\.spec(\.[cm]?[jt]sx?)$/, '$1'), path.replace(/\.spec\.[cm]?[jt]sx?$/, '.vue')]
      : /_tests?\.rs$/.test(path)
        ? [path.replace(/_tests?\.rs$/, '.rs')]
        : [];
    if (paired.some((source) => shared.has(source))) shared.add(path);
  }
  return shared;
}

/** @param {import('./context.mjs').ArchitectureFile} file @param {(line: number, message: string) => void} report @returns {Map<string, {title: string, line: number}>} */
function readModuleIndex(file, report) {
  const lines = file.document.lines;
  const starts = lines.flatMap((line, index) => (line === '### 正式模块' ? [index] : []));
  const entries = new Map();
  const titles = new Set();
  const entryLines = new Set();
  if (starts.length !== 1) {
    report(1, `module map must have exactly one 正式模块 index`);
    return entries;
  }
  const start = starts[0];
  if (lines[start + 1] !== '') report(start + 2, `index heading must have one blank separator`);
  if (!lines[start + 2]) report(start + 3, `module index must start after one blank separator`);
  let inItems = false;
  let ended = false;
  for (let index = start + 2; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('#')) break;
    if (line === '') {
      if (inItems) ended = true;
      continue;
    }
    if (ended) report(index + 1, `module index must be a compact list`);
    inItems = true;
    const match = /^- \[([^[\]]+)\]\(modules\/([^()]+)\)：(\S.*)$/.exec(line);
    if (!match || !MODULE_NAME.test(match[2])) {
      report(index + 1, `module index entry must be - [title](modules/kebab-case.md)：remark`);
      continue;
    }
    const rel = MODULE_DIRECTORY + match[2];
    if (entries.has(rel)) report(index + 1, `duplicate module index entry ${rel}`);
    if (titles.has(match[1])) report(index + 1, `duplicate module index title ${match[1]}`);
    titles.add(match[1]);
    entryLines.add(index);
    entries.set(rel, { title: match[1], line: index + 1 });
  }
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].includes('](modules/') && !entryLines.has(index))
      report(index + 1, `module links must be valid entries inside 正式模块`);
  }
  if (!entries.size) report(1, `module index must contain entries`);
  return entries;
}
