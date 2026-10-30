import { defineRule } from '../../diagnostics.mjs';

const SECTION_ORDER = ['定义', '参考', '边界', '链路', '规范'];
const REFERENCE_GROUPS = ['拥有', '消费', '装配', '关联'];
/** @satisfies {Record<string, number>} */
const MIN_SECTION_LINES = { 参考: 3, 边界: 5, 规范: 5 };
const MAX_DOC_LINES = 300;

export const moduleStructureRule = defineRule(
  'module-structure',
  '.zcode/module-map.md#模块文档规范',
  import.meta.url,
  (context, report) => {
    const map = { rel: '.zcode/module-map.md' };
    for (const failure of context.moduleMap.failures) report(map, failure, failure.message);
    for (const file of context.documents)
      for (const failure of checkDocStructure(file, context.moduleMap.index.get(file.rel)?.title, context.paths))
        report(file, failure, failure.message);
  },
);

/** @param {import('../../facts/context.mjs').ArchitectureFile} file @param {string | undefined} title @param {ReadonlySet<string>} paths @returns {import('../../../shared/frontend-source.mjs').SourceFailure[]} */
function checkDocStructure(file, title, paths) {
  /** @type {import('../../../shared/frontend-source.mjs').SourceFailure[]} */
  const failures = [];
  const lines = [...file.document.lines];
  /** @type {(index: number, message: string) => void} */
  const report = (index, message) => {
    failures.push({ line: index + 1, column: 1, message });
  };
  if (lines.at(-1) === '') lines.pop();
  else report(lines.length - 1, 'module doc must end with one newline');
  if (lines.length > MAX_DOC_LINES) report(0, `module doc exceeds ${MAX_DOC_LINES} lines (${lines.length})`);
  const titleLine = lines[0] ?? '';
  if (
    !/^# [^#\s].*$/.test(titleLine) ||
    !plainLine(titleLine.slice(2)) ||
    /\s#+$/.test(titleLine) ||
    (title !== undefined && titleLine !== '# ' + title)
  )
    report(0, 'module title must be one H1 matching its module map title');
  if (lines[1] !== '') report(1, 'module title must have one blank separator');
  const headings = file.document.headings;
  if (headings.map((heading) => heading.name).join('|') !== SECTION_ORDER.join('|')) {
    report(0, 'H2 headings must occur exactly once in this order: 定义、参考、边界、链路、规范');
    return failures;
  }
  if (/** @type {{index: number}} */ (headings[0]).index !== 2) report(2, '定义 must immediately follow the title separator');
  for (const [index, line] of lines.entries()) {
    if (line !== line.trimEnd() || /\r/.test(line)) report(index, 'trailing whitespace and stray CR are forbidden');
    if (line === '' && (index === lines.length - 1 || lines[index + 1] === '')) report(index, 'extra blank lines are forbidden');
  }
  for (const [section, { index, name }] of headings.entries()) {
    const end = headings[section + 1]?.index ?? lines.length;
    if (lines[index - 1] !== '' || lines[index + 1] !== '') report(index, 'H2 must have one blank line before and after');
    if (section < headings.length - 1 && lines[end - 1] !== '') report(end, 'H2 must have one blank line before');
    const body = lines.slice(index + 2, section < headings.length - 1 ? end - 1 : end);
    if (name === '参考') checkReferences(body, index + 2, paths, report);
    else if (name === '链路') checkChains(body, index + 2, report);
    else checkFlatSection(name, body, index + 2, report);
  }
  return failures;
}

/** @param {string} name @param {string[]} body @param {number} start @param {(index: number, message: string) => void} report */
function checkFlatSection(name, body, start, report) {
  if (name === '定义') {
    if (body.length !== 1 || !plainLine(body[0])) report(start, '定义 must contain exactly one plain text line');
    return;
  }
  const min = MIN_SECTION_LINES[/** @type {keyof typeof MIN_SECTION_LINES} */ (name)];
  if (body.filter(Boolean).length < min) report(start, `${name} must contain at least ${min} entries`);
  const entries = new Set();
  for (const [index, line] of body.entries()) {
    if (!/^- \S.*$/.test(line) || !plainLine(line.slice(2))) {
      report(start + index, `${name} must contain only a compact - unordered list`);
      continue;
    }
    const key = line.slice(2).replace(/`/g, '');
    if (entries.has(key)) report(start + index, `${name} entries must be unique`);
    entries.add(key);
  }
}

/** @param {string[]} body @param {number} start @param {ReadonlySet<string>} paths @param {(index: number, message: string) => void} report */
function checkReferences(body, start, paths, report) {
  let group = -1,
    count = 0,
    entries = 0;
  /** @type {string | null} */
  let previous = null;
  const references = new Set();
  for (const [index, line] of body.entries()) {
    if (line.startsWith('### ')) {
      const next = REFERENCE_GROUPS.indexOf(line.slice(4));
      if (next < 0 || next <= group) report(start + index, 'reference H3 must be unique and ordered: 拥有、消费、装配、关联');
      if (group >= 0 && !count) report(start + index, 'each reference H3 must have a nonempty compact list');
      if (index && body[index - 1] !== '') report(start + index, 'reference H3 must have one blank line before');
      if (body[index + 1] !== '') report(start + index, 'reference H3 must have one blank line after');
      group = next;
      count = 0;
      previous = null;
      continue;
    }
    if (line === '') {
      if (!body[index - 1]?.startsWith('### ') && !body[index + 1]?.startsWith('### '))
        report(start + index, 'reference lists must be compact');
      continue;
    }
    const match = /^- `([^`]+)`：(\S.*)$/.exec(line);
    if (group < 0 || !match || !plainLine(match[2])) {
      report(start + index, '参考 must contain H3 groups and compact - `path`：remark entries');
      continue;
    }
    count++;
    entries++;
    const path = /** @type {string} */ (match[1]),
      identity = path.replace(/\/$/, '');
    const parts = identity.split('/');
    if (
      path !== path.trim() ||
      /[\\:*?"<>|]/.test(path) ||
      [...path].some((character) => character.charCodeAt(0) < 32) ||
      parts.some((part) => !part || part === '.' || part === '..')
    )
      report(start + index, 'reference must use one literal repository-relative file or directory path');
    else if (!paths.has(path) && !paths.has(path + '/')) report(start + index, `reference path does not exist: ${path}`);
    if (references.has(identity)) report(start + index, '参考 paths must be unique across groups');
    references.add(identity);
    if (previous !== null && previous >= path) report(start + index, 'reference group paths must be unique and in dictionary order');
    previous = path;
  }
  if (!count) report(start, 'each reference H3 must have a nonempty compact list');
  if (entries < MIN_SECTION_LINES.参考) report(start, `参考 must contain at least ${MIN_SECTION_LINES.参考} entries`);
}

/** @param {string[]} body @param {number} start @param {(index: number, message: string) => void} report */
function checkChains(body, start, report) {
  let heading = false;
  let step = 0;
  const names = new Set();
  for (const [index, line] of body.entries()) {
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
