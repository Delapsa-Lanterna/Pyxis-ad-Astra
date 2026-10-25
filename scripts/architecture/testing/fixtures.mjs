import assert from 'node:assert/strict';
import { architectureContext } from '../facts/context.mjs';

/** @param {Record<string, string>} sources @returns {import('../facts/context.mjs').ArchitectureContext} */
export function architectureFixtures(sources) {
  const config = JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } });
  return architectureContext(Object.entries({ 'tsconfig.json': config, ...sources }).map(([rel, text]) => ({ path: rel, rel, text })));
}

/** @param {import('../facts/context.mjs').ArchitectureContext} context @param {(file: import('../facts/context.mjs').ArchitectureFile) => boolean} predicate @returns {import('../facts/context.mjs').ArchitectureFile} */
export function fixtureFile(context, predicate) {
  const file = context.files.find(predicate);
  assert.ok(file, 'the declared source fixture exists');
  return file;
}

/** @param {readonly import('../diagnostics.mjs').Diagnostic[]} diagnostics @returns {string[]} */
export function messages(diagnostics) {
  return diagnostics.map(
    ({ file, line, column, message, target }) => file + ':' + line + ':' + column + ': ' + (target ? target + ': ' : '') + message,
  );
}
