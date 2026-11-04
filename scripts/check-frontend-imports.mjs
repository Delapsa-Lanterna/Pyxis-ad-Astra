import ts from 'typescript';
import { existsSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { resolve } from 'node:path';
import { resolveConfig, createIdResolver, BuildEnvironment } from 'vite';
import { parseFrontendSource } from './shared/frontend-source.mjs';
import { sourcePositions } from './shared/source-position.mjs';

/** @param {import('./shared/files.mjs').SourceFile} file */
export function checkInlineTypeImports(file) {
  /** @type {import('./architecture/diagnostics.mjs').Diagnostic[]} */
  const diagnostics = [];
  const at = sourcePositions(file.text);
  parseFrontendSource(file, {
    references: false,
    onNode(node, ast, offset) {
      if (!ts.isImportTypeNode(node)) return;
      diagnostics.push({
        ruleId: 'inline-type-import',
        file: file.rel,
        ...at(offset + node.getStart(ast)),
        message: 'type dependencies must use top-level imports',
        symbol: node.getText(ast),
        expected: 'top-level import type',
        reference: '.zcode/frontend-guidelines.md#类型与分支设计',
        source: 'scripts/check-frontend-imports.mjs',
      });
    },
  });
  return diagnostics;
}

/** @param {import('./shared/files.mjs').SourceFile[]} files @param {string} root */
export async function checkMockSources(files, root) {
  const mocks = files.flatMap((file) => {
    const facts = parseFrontendSource(file);
    const bindings = new Set(
      facts.imports
        .filter((binding) => binding.specifier === 'vitest' && ['vi', 'vitest'].includes(binding.importedName ?? ''))
        .map((binding) => binding.localName),
    );
    return facts.calls
      .filter(
        (call) => bindings.has(call.localName) && ['mock', 'doMock'].includes(call.member ?? '') && typeof call.arguments[0] === 'string',
      )
      .map((call) => ({ file, ...call }));
  });
  if (!mocks.length) return [];
  const config = await resolveConfig({ root, configLoader: 'runner' }, 'build', 'test');
  const environment = new BuildEnvironment('client', config),
    resolveModule = createIdResolver(config);
  /** @type {import('./architecture/diagnostics.mjs').Diagnostic[]} */
  const diagnostics = [];
  for (const call of mocks) {
    const target = /** @type {string} */ (call.arguments[0]);
    if (isBuiltin(target)) continue;
    const resolved = await resolveModule(environment, target, resolve(root, call.file.rel));
    if (resolved && existsSync(resolved.replace(/\?.*$/, ''))) continue;
    diagnostics.push({
      ruleId: 'mock-module-source',
      file: call.file.rel,
      line: call.line,
      column: call.column,
      message: 'mock source must resolve to an existing module',
      target,
      symbol: target,
      expected: 'existing module',
      reference: '.zcode/frontend-guidelines.md#测试',
      source: 'scripts/check-frontend-imports.mjs',
    });
  }
  return diagnostics;
}
