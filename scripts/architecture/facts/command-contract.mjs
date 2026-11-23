import ts from 'typescript';
import { frontendTypes } from './frontend-types.mjs';
import { splitTopLevel } from '../../shared/rust-source.mjs';
import { sourcePositions } from '../../shared/source-position.mjs';

/** @param {import('./context.mjs').ArchitectureFile} entry */
export function commandRegistrations(entry) {
  const location = sourcePositions(entry.text);
  const registrations = [];
  for (const macro of entry.rust.code.matchAll(/\bcommand_macros\s*::\s*generate_handler\s*!\s*\[([^\]]*)\]/g)) {
    const body = /** @type {string} */ (macro[1]);
    const start = macro.index + macro[0].indexOf('[') + 1;
    for (const path of body.matchAll(/(?:^|,)\s*((?:(?:r#)?\w+\s*::\s*)*(?:r#)?\w+)\s*(?=,|$)/g)) {
      const parts = /** @type {string} */ (path[1]).split(/\s*::\s*/);
      const name = /** @type {string} */ (parts.at(-1));
      registrations.push({ name, ...location(start + path.index + path[0].lastIndexOf(name)) });
    }
  }
  return registrations;
}

/** @param {import('./rust.mjs').RustFunction} fn */
export function commandParameters(fn) {
  const snake = /\brename_all\s*=\s*"snake_case"/.test(fn.attributeArguments.get('command_macros::command') ?? '');
  const fields = new Map();
  for (const param of splitTopLevel(fn.parameters)) {
    const parts = /^\s*(?:mut\s+)?(?:r#)?(\w+)\s*:\s*(.+)$/s.exec(param);
    if (!parts) continue;
    const name = /** @type {string} */ (parts[1]),
      type = /** @type {string} */ (parts[2]);
    if (/^(?:tauri\s*::\s*)?(?:AppHandle|WebviewWindow|Webview|Window|State)\b|^tauri\s*::\s*ipc\s*::\s*Request\b/.test(type)) continue;
    const key = snake ? name : name.replace(/_(\w)/g, (_, letter) => letter.toUpperCase());
    fields.set(key, !/^(?:(?:std|core)::option::)?Option\s*</.test(type));
  }
  return fields;
}

/** @param {import('./context.mjs').ArchitectureContext} context */
export function commandArgumentTypes(context) {
  /** @param {ts.Expression} expression */
  return function properties(expression) {
    const view = frontendTypes(context);
    const type = view.type(expression);
    if (!type) return undefined;
    const branches = type.isUnion() ? type.types : [type];
    const keys = new Map();
    for (const branch of branches) {
      if (branch.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) || view.checker.getIndexTypeOfType(branch, ts.IndexKind.String))
        return undefined;
      for (const property of view.checker.getPropertiesOfType(branch)) {
        const previous = keys.get(property.name) ?? 0;
        keys.set(property.name, previous + Number(!(property.flags & ts.SymbolFlags.Optional)));
      }
    }
    return [...keys].map(([key, count]) => ({ key, required: count === branches.length }));
  };
}

/** @param {ts.Expression | undefined} expression @param {ReturnType<typeof commandArgumentTypes>} properties */
export function commandArgumentKeys(expression, properties) {
  const keys = new Map();
  let complete = true;
  if (!expression) return { keys, complete };
  if (ts.isObjectLiteralExpression(expression)) {
    for (const prop of expression.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const spread = properties(prop.expression);
        if (spread) for (const { key, required } of spread) keys.set(key, keys.get(key) || required);
        else complete = false;
      } else if (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name)) keys.set(prop.name.text, true);
      else complete = false;
    }
  } else {
    const fields = properties(expression);
    if (fields) for (const { key, required } of fields) keys.set(key, required);
    else complete = false;
  }
  return { keys, complete };
}
