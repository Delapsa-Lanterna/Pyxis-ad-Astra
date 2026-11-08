import { pairedSourcePaths } from '../../../shared/files.mjs';
import { specFile, frontendFile } from '../../facts/classify.mjs';
import { defineRule } from '../../diagnostics.mjs';

const moduleDirectory = '.zcode/modules/';

export const moduleOwnershipRule = defineRule('module-ownership', '.zcode/module-map.md#登记与归属', import.meta.url, (context, report) => {
  const { index, shared, owners, ownershipReferences } = context.moduleMap;
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
  for (const file of context.documents) {
    for (const line of file.document.styleLines)
      report(file, { line, column: 1 }, 'module documents must not contain CSS references or rules');
  }
  /** @type {Map<string,{file:string,line:number}>} */
  const declarations = new Map();
  for (const reference of ownershipReferences) {
    const owner = { file: context.byPath.get(reference.file), line: reference.line, path: reference.path };
    if (shared.has(reference.rel)) {
      report(owner.file ?? map, { line: owner.line, column: 1 }, 'public file ' + reference.rel + ' cannot have module ownership', {
        target: reference.rel,
        symbol: reference.path,
        expected: 'public file consumer',
      });
      continue;
    }
    const previous = declarations.get(reference.rel);
    if (previous && previous.file !== reference.file)
      report(owner.file ?? map, { line: owner.line, column: 1 }, 'ownership of ' + reference.rel + ' conflicts with ' + previous.file, {
        target: reference.rel,
        symbol: reference.path,
        expected: previous.file,
      });
    else declarations.set(reference.rel, { file: reference.file, line: owner.line });
  }
  for (const rel of context.paths) {
    if (!index.size) break;
    if (rel.endsWith('/') || specFile(rel) || /(?:^|\/)tests?\//.test(rel)) continue;
    if (!/^(?:src\/|src-tauri\/|scripts\/|schemas\/|\.github\/)/.test(rel) && !/^[^/]+\.(?:[cm]?[jt]s|json|html|toml|ps1|bat)$/.test(rel))
      continue;
    if (!owners.has(rel) && !shared.has(rel))
      report({ rel }, { line: 1, column: 1 }, 'repository files must have one module owner or public identity', {
        target: rel,
        expected: 'module ownership or public registration',
      });
    const file = context.byPath.get(rel);
    if (
      frontendFile(rel) &&
      !shared.has(rel) &&
      file?.role.layer === 'unknown' &&
      file.syntax.scripts.some(({ ast }) => ast.statements.length)
    )
      report({ rel }, { line: 1, column: 1 }, 'production source must belong to a declared architecture layer', {
        target: rel,
        expected: 'declared frontend layer',
      });
  }
  for (const [rel, module] of owners)
    for (const source of pairedSourcePaths(rel)) {
      const implementation = owners.get(source);
      if (implementation && implementation !== module)
        report({ rel }, { line: 1, column: 1 }, 'test ownership conflicts with ' + source + ' in ' + implementation, {
          target: source,
          symbol: rel,
          expected: implementation,
        });
    }
});
