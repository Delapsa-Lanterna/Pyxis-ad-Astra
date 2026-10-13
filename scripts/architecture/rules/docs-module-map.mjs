import { singleFileByRel } from '../../shared/files.mjs';

const SECTION_ORDER = ['定义', '参考', '边界', '链路', '规范', '陷阱'];
/** @type {Record<string, number>} */
const MIN_SECTION_LINES = { 参考: 3, 边界: 5, 规范: 5, 陷阱: 3 };
const MAX_DOC_LINES = 300;
const MODULE_DIRECTORY = '.zcode/modules/';
const MODULE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export const docsModuleMapRule = {
  name: 'docs-module-map',
  /** @param {import('../../shared/files.mjs').RepoFile[]} files @returns {string[]} */
  check(files) {
    /** @type {string[]} */
    const failures = [];
    const moduleMap = singleFileByRel(files, '.zcode/module-map.md');
    if (!moduleMap) {
      return ['.zcode/module-map.md: module map index file is missing'];
    }

    const indexed = readModuleIndex(moduleMap, failures);
    const paths = moduleMap.repositoryPaths;
    const onDisk = [...paths].filter((rel) => rel.startsWith(MODULE_DIRECTORY) && rel !== MODULE_DIRECTORY);
    for (const rel of onDisk) {
      if (!MODULE_NAME.test(rel.slice(MODULE_DIRECTORY.length))) {
        failures.push(`${rel}: modules must contain only direct kebab-case .md files`);
      } else if (!indexed.has(rel)) failures.push(`${rel}: module doc must have exactly one module map entry`);
    }
    for (const [rel, entry] of indexed) {
      if (!paths.has(rel)) failures.push(`${moduleMap.rel}:${entry.line}: indexed doc ${rel} does not exist`);
    }
    for (const file of files.filter((file) => file.rel.startsWith(MODULE_DIRECTORY) && file.rel.endsWith('.md'))) {
      failures.push(...checkDocStructure(file, indexed.get(file.rel)?.title, paths));
    }
    return failures;
  },
};

/** @param {import('../../shared/files.mjs').RepoFile} file @param {string[]} failures @returns {Map<string, {title: string, line: number}>} */
function readModuleIndex(file, failures) {
  const lines = file.text.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => (line === '### 正式模块' ? [index] : []));
  const entries = new Map();
  const titles = new Set();
  const entryLines = new Set();
  if (starts.length !== 1) {
    failures.push(`${file.rel}: module map must have exactly one 正式模块 index`);
    return entries;
  }
  const start = starts[0];
  if (lines[start + 1] !== '') failures.push(`${file.rel}:${start + 2}: index heading must have one blank separator`);
  if (!lines[start + 2]) failures.push(`${file.rel}:${start + 3}: module index must start after one blank separator`);
  let inItems = false;
  let ended = false;
  for (let index = start + 2; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('#')) break;
    if (line === '') {
      if (inItems) ended = true;
      continue;
    }
    if (ended) failures.push(`${file.rel}:${index + 1}: module index must be a compact list`);
    inItems = true;
    const match = /^- \[([^[\]]+)\]\(modules\/([^()]+)\)：(\S.*)$/.exec(line);
    if (!match || !MODULE_NAME.test(match[2])) {
      failures.push(`${file.rel}:${index + 1}: module index entry must be - [title](modules/kebab-case.md)：remark`);
      continue;
    }
    const rel = MODULE_DIRECTORY + match[2];
    if (entries.has(rel)) failures.push(`${file.rel}:${index + 1}: duplicate module index entry ${rel}`);
    if (titles.has(match[1])) failures.push(`${file.rel}:${index + 1}: duplicate module index title ${match[1]}`);
    titles.add(match[1]);
    entryLines.add(index);
    entries.set(rel, { title: match[1], line: index + 1 });
  }
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].includes('](modules/') && !entryLines.has(index))
      failures.push(`${file.rel}:${index + 1}: module links must be valid entries inside 正式模块`);
  }
  if (!entries.size) failures.push(`${file.rel}: module index must contain entries`);
  return entries;
}

/** @param {import('../../shared/files.mjs').RepoFile} file @param {string | undefined} title @param {ReadonlySet<string>} paths @returns {string[]} */
function checkDocStructure(file, title, paths) {
  /** @type {string[]} */
  const failures = [];
  const lines = file.text.split(/\r?\n/);
  /** @type {(index: number, message: string) => void} */
  const report = (index, message) => {
    failures.push(`${file.rel}:${index + 1}: ${message}`);
  };
  if (lines.at(-1) === '') lines.pop();
  else report(lines.length - 1, 'module doc must end with one newline');
  if (lines.length > MAX_DOC_LINES) report(0, `module doc exceeds ${MAX_DOC_LINES} lines (${lines.length})`);
  if (
    !/^# [^#\s].*$/.test(lines[0]) ||
    !plainLine(lines[0]?.slice(2)) ||
    /\s#+$/.test(lines[0]) ||
    (title !== undefined && lines[0] !== '# ' + title)
  )
    report(0, 'module title must be one H1 matching its module map title');
  if (lines[1] !== '') report(1, 'module title must have one blank separator');
  const headings = lines.flatMap((line, index) => (line.startsWith('## ') ? [{ index, name: line.slice(3) }] : []));
  if (headings.map((heading) => heading.name).join('|') !== SECTION_ORDER.join('|')) {
    report(0, 'H2 headings must occur exactly once in this order: 定义、参考、边界、链路、规范、陷阱');
    return failures;
  }
  if (headings[0].index !== 2) report(2, '定义 must immediately follow the title separator');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line !== line.trimEnd() || /\r/.test(line)) report(index, 'trailing whitespace and stray CR are forbidden');
    if (line === '' && (index === lines.length - 1 || lines[index + 1] === '')) report(index, 'extra blank lines are forbidden');
  }
  for (let section = 0; section < headings.length; section++) {
    const { index, name } = headings[section];
    const end = headings[section + 1]?.index ?? lines.length;
    if (lines[index - 1] !== '' || lines[index + 1] !== '') report(index, 'H2 must have one blank line before and after');
    if (section < headings.length - 1 && lines[end - 1] !== '') report(end, 'H2 must have one blank line before');
    const body = lines.slice(index + 2, section < headings.length - 1 ? end - 1 : end);
    if (name === '链路') checkChains(body, index + 2, report);
    else checkFlatSection(name, body, index + 2, paths, report);
  }
  return failures;
}

/** @param {string} name @param {string[]} body @param {number} start @param {ReadonlySet<string>} paths @param {(index: number, message: string) => void} report */
function checkFlatSection(name, body, start, paths, report) {
  if (name === '定义') {
    if (body.length !== 1 || !plainLine(body[0])) report(start, '定义 must contain exactly one plain text line');
    return;
  }
  const min = MIN_SECTION_LINES[name];
  if (body.filter(Boolean).length < min) report(start, `${name} must contain at least ${min} entries`);
  let previous = null;
  const references = new Set();
  for (let index = 0; index < body.length; index++) {
    const line = body[index];
    if (name === '参考') {
      const match = /^`([^`]+)`：(\S.*)$/.exec(line);
      if (!match || !plainLine(match[2])) {
        report(start + index, '参考 must contain compact `directory/file`：remark lines');
        continue;
      }
      const path = match[1];
      const parts = path.replace(/\/$/, '').split('/');
      if (
        path !== path.trim() ||
        /[\\:*?"<>|]/.test(path) ||
        [...path].some((character) => character.charCodeAt(0) < 32) ||
        parts.some((part) => !part || part === '.' || part === '..')
      ) {
        report(start + index, 'reference must use one literal repository-relative file or directory path');
      } else if (!paths.has(path) && !paths.has(path + '/')) report(start + index, `reference path does not exist: ${path}`);
      const identity = path.replace(/\/$/, '');
      if (references.has(identity)) report(start + index, '参考 paths must be unique');
      references.add(identity);
      if (previous !== null && previous > path) report(start + index, '参考 paths must be in dictionary order');
      previous = path;
    } else {
      if (!/^- \S.*$/.test(line) || !plainLine(line.slice(2))) {
        report(start + index, `${name} must contain only a compact - unordered list`);
        continue;
      }
      const key = line.slice(2).replace(/`/g, '');
      if (previous !== null && previous >= key) report(start + index, `${name} entries must be unique and in dictionary order`);
      previous = key;
    }
  }
}

/** @param {string[]} body @param {number} start @param {(index: number, message: string) => void} report */
function checkChains(body, start, report) {
  let heading = false;
  let step = 0;
  const names = new Set();
  for (let index = 0; index < body.length; index++) {
    const line = body[index];
    if (/^### \S.*$/.test(line) && !/\s#+$/.test(line) && plainLine(line.slice(4))) {
      if (heading && !step) report(start + index, 'each chain H3 must have an ordered list');
      if (index && (body[index - 1] !== '' || !step)) report(start + index, 'chain headings must have one blank separator');
      if (body[index + 1] !== '') report(start + index, 'H3 must have one blank line after');
      if (names.has(line)) report(start + index, 'chain H3 titles must be unique');
      names.add(line);
      heading = true;
      step = 0;
    } else if (line === '') {
      if (!heading || (body[index - 1]?.startsWith('### ') !== true && body[index + 1]?.startsWith('### ') !== true))
        report(start + index, '链路 lists must be compact');
    } else {
      const match = /^([1-9][0-9]*)\. (\S.*)$/.exec(line);
      if (!heading || !match || !plainLine(match[2])) report(start + index, '链路 must contain only H3 headings and compact ordered lists');
      else {
        step++;
        if (match[1] !== String(step)) report(start + index, `chain ordered list must use consecutive numbering; expected ${step}`);
      }
    }
  }
  if (!heading || !step) report(start, '链路 must contain H3 headings with nonempty ordered lists');
}

/** @param {string | undefined} line @returns {boolean} */
function plainLine(line) {
  return (
    typeof line === 'string' &&
    line.length > 0 &&
    line === line.trim() &&
    !/(?:<!--|<\/?[A-Za-z][^>]*>|!\[)/.test(line.replace(/`[^`]*`/g, '')) &&
    !/^(?:#{1,6}(?:\s|$)|[>|]|[-+*]\s|[0-9]+[.)]\s|[-*_]{3,}(?:\s|$)|`{3}|~{3}|<|!\[|\[[^\]]+\]:)/.test(line)
  );
}
