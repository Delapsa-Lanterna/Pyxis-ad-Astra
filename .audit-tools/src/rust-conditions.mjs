/** @param {string} text @returns {string[]} */
function argumentsOf(text) {
  const values = [];
  let depth = 0,
    quoted = false,
    start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && text[index - 1] !== '\\') quoted = !quoted;
    if (quoted) continue;
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      values.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  values.push(text.slice(start).trim());
  return values.filter(Boolean);
}
/** Unknown platform and feature predicates retain both possible values.
 * @param {string} expression @param {Map<string, boolean | null>} [assignments] @returns {boolean | null} */
function predicateEnabled(expression, assignments = new Map([['test', false]])) {
  const value = expression.trim();
  if (assignments.has(value)) return assignments.get(value) ?? null;
  const match = /^(all|any|not)\s*\(([\s\S]*)\)$/.exec(value);
  if (!match) {
    assignments.set(value, null);
    return null;
  }
  const values = argumentsOf(/** @type {string} */ (match[2])).map((item) => predicateEnabled(item, assignments));
  if (match[1] === 'not') return values[0] === null ? null : !values[0];
  if (match[1] === 'all') return values.includes(false) ? false : values.every((item) => item === true) ? true : null;
  return values.includes(true) ? true : values.every((item) => item === false) ? false : null;
}
/** @param {string} attribute @param {Map<string, boolean | null>} [assignments] @returns {boolean | null} */
function attributeEnabled(attribute, assignments = new Map([['test', false]])) {
  const text = attribute.replace(/^#!?\[|\]$/g, '').trim();
  if (text === 'test') return predicateEnabled('test', assignments);
  const match = /^(cfg|cfg_attr)\s*\(([\s\S]*)\)$/.exec(text);
  if (!match) return true;
  const expression = /** @type {string} */ (match[2]);
  if (match[1] === 'cfg') return predicateEnabled(expression, assignments);
  const [condition, ...attributes] = /** @type {[string, ...string[]]} */ (argumentsOf(expression));
  const active = predicateEnabled(condition, assignments);
  if (active === false) return true;
  const results = attributes.map((item) => attributeEnabled('#[' + item + ']', assignments));
  const applied = results.includes(false) ? false : results.every((item) => item === true) ? true : null;
  return active === true ? applied : applied === true ? true : null;
}
/** @param {string} condition */
export function rustTestOnly(condition) {
  const attributes = condition.match(/#!?\[[^\]]*\]/g) ?? [];
  return attributes.some((attribute) => attributeEnabled(attribute) === false);
}
/** @param {import('web-tree-sitter').Node} node @param {string} [parent] */
export function rustCondition(node, parent = '') {
  const attributes = [];
  for (let previous = node.previousNamedSibling; previous?.type === 'attribute_item'; previous = previous.previousNamedSibling)
    attributes.unshift(previous.text);
  if (node.type === 'source_file')
    for (const child of node.namedChildren) if (child.type === 'inner_attribute_item') attributes.push(child.text);
  return [parent, ...attributes].filter(Boolean).join(' ');
}

/** @param {string} left @param {string} right */
export function rustConditionsOverlap(left, right) {
  const attributes = (left + ' ' + right).match(/#!?\[[^\]]*\]/g) ?? [];
  /** @param {Map<string, boolean | null>} assignments @returns {boolean} */
  function possible(assignments) {
    // Rust target-family flags cannot enable Windows and Unix together.
    if (assignments.get('windows') === true && assignments.get('unix') === true) return false;
    const values = attributes.map((attribute) => attributeEnabled(attribute, assignments));
    if (values.includes(false)) return false;
    if (values.every((value) => value === true)) return true;
    const [name] = /** @type {[string, null]} */ ([...assignments].find(([, value]) => value === null));
    return [false, true].some((value) => possible(new Map(assignments).set(name, value)));
  }
  return possible(new Map());
}

/** Uses compiler facts while retaining unknown feature and test conditions.
 * @param {string} condition @param {string[]} cfg @returns {boolean | null} */
export function rustConditionEnabled(condition, cfg) {
  /** @param {string} value */
  const normalise = (value) => value.replace(/\s*=\s*/g, '=');
  const assignments = new Map(cfg.map((value) => [normalise(value), true]));
  if (cfg.length) for (const family of ['windows', 'unix']) assignments.set(family, cfg.includes(family));
  const values = (normalise(condition).match(/#!?\[[^\]]*\]/g) ?? []).map((attribute) => attributeEnabled(attribute, assignments));
  return values.includes(false) ? false : values.every((value) => value === true) ? true : null;
}
