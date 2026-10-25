import { defineRule } from '../../diagnostics.mjs';

const moduleDirectory = '.zcode/modules/';

/** @param {string} rel @returns {string[]} */
function pairedSources(rel) {
  if (/\.spec\.[cm]?[jt]sx?$/.test(rel))
    return [rel.replace(/\.spec(\.[cm]?[jt]sx?)$/, '$1'), rel.replace(/\.spec\.[cm]?[jt]sx?$/, '.vue')];
  if (/_tests?\.rs$/.test(rel)) return [rel.replace(/_tests?\.rs$/, '.rs')];
  return [];
}

export const moduleOwnershipRule = defineRule('module-ownership', '.zcode/module-map.md#登记与归属', import.meta.url, (context, report) => {
  const { index, shared, descendants } = context.moduleMap;
  const map = { rel: '.zcode/module-map.md' };
  for (const rel of context.paths) {
    if (!rel.startsWith(moduleDirectory) || rel === moduleDirectory) continue;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(rel.slice(moduleDirectory.length)))
      report({ rel }, { line: 1, column: 1 }, 'modules must contain only direct kebab-case .md files');
    else if (!index.has(rel)) report({ rel }, { line: 1, column: 1 }, 'module doc must have exactly one module map entry');
  }
  for (const [rel, entry] of index)
    if (!context.paths.has(rel))
      report(map, { line: entry.line, column: 1 }, 'indexed doc ' + rel + ' does not exist', {
        target: rel,
        symbol: entry.title,
        expected: 'existing module document',
      });
  /** @type {Map<string, {file: import('../../facts/context.mjs').ArchitectureFile, line: number}>} */
  const owners = new Map();
  for (const file of context.documents) {
    for (const line of file.document.styleLines)
      report(file, { line, column: 1 }, 'module documents must not contain CSS references or rules');
    for (const reference of file.document.references) {
      if (reference.group !== '拥有') continue;
      const target = reference.path.replace(/\/$/, '');
      for (const rel of descendants.get(target) ?? []) {
        if (shared.has(rel)) {
          report(file, { line: reference.line, column: 1 }, 'public file ' + rel + ' cannot have module ownership', {
            target: rel,
            symbol: reference.path,
            expected: 'public file consumer',
          });
          continue;
        }
        const previous = owners.get(rel);
        if (previous && previous.file.rel !== file.rel)
          report(file, { line: reference.line, column: 1 }, 'ownership of ' + rel + ' conflicts with ' + previous.file.rel, {
            target: rel,
            symbol: reference.path,
            expected: previous.file.rel,
          });
        owners.set(rel, { file, line: reference.line });
      }
    }
  }
  for (const [rel, owner] of owners)
    for (const source of pairedSources(rel)) {
      const implementation = owners.get(source);
      if (implementation && implementation.file.rel !== owner.file.rel)
        report({ rel }, { line: 1, column: 1 }, 'test ownership conflicts with ' + source + ' in ' + implementation.file.rel, {
          target: source,
          symbol: rel,
          expected: implementation.file.rel,
        });
    }
});
