import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';

/** @typedef {{ruleId: string, file: string, line: number, column: number, message: string, target?: string, symbol?: string, expected?: string}} Diagnostic */
/** @typedef {{line: number, column: number}} Position */
/** @typedef {Position & {bindings?: import('./facts/imports.mjs').ImportSpecifierInfo[], target?: string | string[]}} EvidencePosition */
/** @typedef {(file: {rel: string}, position: EvidencePosition, message: string, relation?: {target?: string, symbol?: string, expected?: string}) => void} Report */
/** @typedef {{name: string, reference: string, source: string, check: (context: import('./facts/context.mjs').ArchitectureContext) => Diagnostic[]}} ArchitectureRule */

/** @param {string} name @param {string} reference @param {string} source @param {(context: import('./facts/context.mjs').ArchitectureContext, report: Report) => void} check @returns {ArchitectureRule} */
export function defineRule(name, reference, source, check) {
  return {
    name,
    reference,
    source: relative(process.cwd(), fileURLToPath(source)).replaceAll('\\', '/'),
    check(context) {
      /** @type {Diagnostic[]} */
      const diagnostics = [];
      check(context, (file, position, message, relation) => {
        const symbol =
          position.bindings?.map((binding) => binding.importedName ?? '*').join(', ') ??
          (Array.isArray(position.target) ? position.target.at(-1) : undefined);
        diagnostics.push({
          ruleId: name,
          file: file.rel,
          line: position.line,
          column: position.column,
          message,
          ...(symbol ? { symbol } : {}),
          ...relation,
        });
      });
      return diagnostics;
    },
  };
}

/** @param {Diagnostic} diagnostic @returns {string} */
export function formatDiagnostic(diagnostic) {
  const { file, line, column, ruleId, message, target } = diagnostic;
  return `${file}:${line}:${column}: [${ruleId}] ${target ? target + ': ' : ''}${message}`;
}

/** @param {readonly Diagnostic[]} diagnostics @returns {Diagnostic[]} */
export function sortedDiagnostics(diagnostics) {
  return [...diagnostics].sort(
    (a, b) =>
      a.file.localeCompare(b.file, 'en') ||
      a.line - b.line ||
      a.column - b.column ||
      a.ruleId.localeCompare(b.ruleId, 'en') ||
      a.message.localeCompare(b.message, 'en'),
  );
}
