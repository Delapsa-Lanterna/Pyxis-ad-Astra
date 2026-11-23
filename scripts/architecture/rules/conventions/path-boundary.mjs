import { defineRule } from '../../diagnostics.mjs';
import ts from 'typescript';
import { sourceChecker } from '../../../shared/frontend-source.mjs';
import { callsFrom } from '../../facts/imports.mjs';

const pathOwner = 'src-tauri/src/io/paths.rs';
const keyOwner = 'src-tauri/src/models/window.rs';
const frontendOwner = 'src/shared/lib/paths.ts';
const caseMethods = new Set(['toLowerCase', 'toUpperCase', 'toLocaleLowerCase', 'toLocaleUpperCase']);
const pathProperties = new Set(['modRoot', 'starsectorRoot', 'relPath', 'absolutePath', 'filePath']);

/** @param {ts.Expression} node @param {ts.TypeChecker} checker @param {(call:ts.CallExpression)=>boolean} normalizes @param {Set<ts.Node>} [seen] @returns {boolean} */
function diskPath(node, checker, normalizes, seen = new Set()) {
  if (seen.has(node)) return false;
  seen.add(node);
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return diskPath(node.expression, checker, normalizes, seen);
  if (ts.isPropertyAccessExpression(node)) return pathProperties.has(node.name.getText());
  if (ts.isIdentifier(node)) {
    const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.parent.flags & ts.NodeFlags.Const && declaration.initializer)
      return diskPath(declaration.initializer, checker, normalizes, seen);
    return pathProperties.has(node.getText());
  }
  if (!ts.isCallExpression(node)) return false;
  if (normalizes(node)) return true;
  // Replacing a filesystem separator establishes a path even when the parameter is simply called "path".
  return (
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.getText() === 'replace' &&
    ((node.arguments[0]?.getText() === '/\\\\/g' && node.arguments[1]?.getText().slice(1, -1) === '/') ||
      diskPath(node.expression.expression, checker, normalizes, seen))
  );
}

/** @param {ts.CallExpression} call */
function usedForSearch(call) {
  const member = call.parent;
  return (
    ts.isPropertyAccessExpression(member) &&
    member.expression === call &&
    ['includes', 'endsWith', 'indexOf'].includes(member.name.getText())
  );
}

export const pathBoundaryRule = defineRule(
  'path-boundary',
  '.zcode/modules/rust-file-io-changeset.md#规范',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      if (!file.frontend.properties.some((property) => caseMethods.has(property.name))) continue;
      const formalCalls = callsFrom(file, context.byPath, new Set([frontendOwner])).filter((call) =>
        ['normalizeRelPath', 'normalizeFsPath', 'joinRootRelativePath', 'relativePathFromRoot'].includes(call.name),
      );
      for (const { ast, offset } of file.syntax.scripts) {
        const checker = sourceChecker(ast);
        /** @param {ts.CallExpression} call */
        function normalizes(call) {
          const at = file.positionAt(offset + call.getStart(ast));
          return formalCalls.some((formal) => formal.line === at.line && formal.column === at.column);
        }
        /** @param {ts.Node} node */
        function visit(node) {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            caseMethods.has(node.expression.name.getText()) &&
            (file.rel === frontendOwner || (!usedForSearch(node) && diskPath(node.expression.expression, checker, normalizes)))
          )
            report(
              file,
              file.positionAt(offset + node.expression.name.getStart(ast)),
              'Windows path identity must consume the native UTF-16 mapping',
              {
                symbol: node.expression.name.getText(),
                expected: file.rel === frontendOwner ? 'initializeWindowsPathCase' : 'normalizeFsPath',
              },
            );
          ts.forEachChild(node, visit);
        }
        visit(ast);
      }
    }
    for (const file of context.rust) {
      if (!file.rel.startsWith('src-tauri/src/') || file.rel === 'src-tauri/src/test_support.rs') continue;
      for (const call of file.rust.calls) {
        if ([keyOwner, pathOwner].includes(file.rel) && ['to_lowercase', 'to_uppercase'].includes(call.name))
          report(file, call, 'Windows path identity must consume the native UTF-16 mapping', { expected: 'windows_path_case' });
        if (
          ['std::fs::canonicalize', 'std::path::Path::canonicalize', 'std::path::PathBuf::canonicalize'].includes(call.target) &&
          file.rel !== pathOwner
        )
          report(file, call, 'disk path expansion belongs to the IO path boundary', { target: call.target, expected: pathOwner });
      }
      if ([pathOwner, keyOwner].includes(file.rel)) continue;
      for (const fn of file.rust.functions) {
        const calls = file.rust.calls.filter((call) => call.offset > fn.start + fn.signature.length && call.offset < fn.end);
        const paths = new Set(
          [...fn.signature.matchAll(/\b(\w+)\s*:\s*&(?:'\w+\s+)?(?:mut\s+)?([\w:]+)/g)]
            .filter(
              (match) =>
                /^(?:std::path::)?Path(?:Buf)?$/.test(match[2] ?? '') ||
                file.rust.references.some(
                  (edge) =>
                    edge.offset === fn.start + match.index + match[0].lastIndexOf(match[2] ?? '') &&
                    /^std::path::Path(?:Buf)?$/.test(edge.target.join('::')),
                ),
            )
            .map((match) => match[1]),
        );
        const expanded = new Map();
        if (
          calls.some((call) =>
            ['to_lowercase', 'to_uppercase', 'to_ascii_lowercase', 'to_ascii_uppercase', 'eq_ignore_ascii_case'].includes(call.name),
          )
        )
          for (const binding of file.rust.code.slice(fn.start, fn.end).matchAll(/\blet\s+(?:mut\s+)?(\w+)\s*(?::[^=;]+)?=([^;]+);/g)) {
            const start = fn.start + binding.index;
            if (
              calls.some(
                (call) =>
                  call.offset >= start &&
                  call.offset < start + binding[0].length &&
                  ['io::canonical_path', 'io::paths::canonical_path'].includes(call.target),
              ) &&
              !/\.(?:file_name|file_stem|extension|parent)\s*\(/.test(binding[0])
            )
              expanded.set(binding[1], start);
          }
        for (const call of calls) {
          const prefix = file.rust.code.slice(fn.start, call.offset);
          const operand = /\b((?:\w+\s*\.\s*)*\w+)\s*(?:\.\s*to_string_lossy\s*\(\s*\)\s*)?\.\s*$/.exec(prefix)?.[1]?.replace(/\s/g, '');
          if (
            operand &&
            ['to_lowercase', 'to_uppercase', 'to_ascii_lowercase', 'to_ascii_uppercase', 'eq_ignore_ascii_case'].includes(call.name) &&
            (paths.has(operand) || expanded.get(operand) < call.offset || /(?:^|\.)(?:root|mod_root|canonical_root)$|\.path$/.test(operand))
          )
            report(file, call, 'filesystem identity comparison must consume the shared path key', {
              target: operand,
              expected: 'models::windows_path_key',
            });
          if (call.target !== 'models::windows_path_key') continue;
          const argument = call.arguments[0] ?? '';
          const raw = new Set(paths);
          for (const binding of prefix.matchAll(/\blet\s+(?:mut\s+)?(\w+)\s*(?::[^=;]+)?=([^;]+);/g)) {
            const name = /** @type {string} */ (binding[1]);
            const expression = /** @type {string} */ (binding[2]);
            const input = [...raw].find((path) => new RegExp('\\b' + path + '\\b').test(expression));
            if (!input) continue;
            const start = fn.start + binding.index;
            const expansion = calls.find(
              (candidate) =>
                candidate.offset >= start &&
                candidate.offset < start + binding[0].length &&
                ['io::canonical_path', 'io::paths::canonical_path', 'io::FsRootBoundary::new', 'io::paths::FsRootBoundary::new'].includes(
                  candidate.target,
                ) &&
                new RegExp('\\b' + input + '\\b').test(candidate.arguments[0] ?? ''),
            );
            if (expansion) raw.delete(name);
            else raw.add(name);
          }
          for (const path of raw) {
            if (new RegExp('\\b' + path + '\\b').test(argument))
              report(file, call, 'raw disk paths must be expanded before string key construction', {
                target: path,
                expected: 'io::canonical_path or FsRootBoundary',
              });
          }
        }
      }
    }
  },
);
