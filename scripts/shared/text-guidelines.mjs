const CJK = '\\p{Script=Han}';
const LATIN = '[A-Za-z]';
const MASK_CHAR = '\uE000';
const BANNED_PUNCTUATION = /[“”‘’（）]/gu;
const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.rs', '.toml', '.ts', '.vue']);
const TEST_PATH = /(?:^|\/)(?:test|tests|testdata|__tests__)(?:\/|$)|(?:^|\/)testutil\.[^.]+$|(?:\.spec|\.test)\.[^.]+$/;

/** @typedef {{ rel: string, text: string }} TextFile */
/** @typedef {{ start: number, text: string, strictOuter?: boolean }} TextCandidate */

/** @param {string} rel @param {string} extension */
export function isTextGuidelineFile(rel, extension) {
  return TEXT_EXTENSIONS.has(extension) && !rel.startsWith('scripts/') && !TEST_PATH.test(rel);
}

/** @param {TextFile[]} files @returns {string[]} */
export function checkTextGuidelines(files) {
  /** @type {string[]} */
  const failures = [];
  for (const file of files) {
    for (const candidate of extractCandidates(file.rel, file.text)) scanCandidate(file.rel, file.text, candidate, failures);
  }
  return failures;
}

/** @param {string} rel @param {string} text @returns {TextCandidate[]} */
function extractCandidates(rel, text) {
  const extension = rel.slice(rel.lastIndexOf('.'));
  if (extension === '.md') return [{ start: 0, text: text.replace(/```[\s\S]*?```|`[^`]*`/g, mask), strictOuter: true }];
  if (extension === '.json') return jsonValueCandidates(text);
  if (extension === '.vue') return vueCandidates(text);
  return quotedCandidates(text);
}

/** @param {string} text @returns {TextCandidate[]} */
function jsonValueCandidates(text) {
  const candidates = [];
  const visibleKey =
    /^(?:label|description|title|name|displayName|message|text|content|placeholder|alt|ariaLabel|heading|summary|hint|error|warning|success|actionText)$/u;
  for (const match of text.matchAll(/"([^"\\]+)"\s*:\s*"((?:\\.|[^"\\])*)"/gu)) {
    const start = match.index ?? 0;
    candidates.push({
      start: start + match[0].indexOf(/** @type {string} */ (match[2])),
      text: /** @type {string} */ (match[2]),
      strictOuter: visibleKey.test(/** @type {string} */ (match[1])),
    });
  }
  return candidates;
}

/** @param {string} text @returns {TextCandidate[]} */
function vueCandidates(text) {
  const scriptStart = text.indexOf('<script');
  const template = scriptStart < 0 ? text : text.slice(0, scriptStart);
  const candidates = [];
  let cursor = 0;
  let tagStart = -1;
  let quote = '';
  for (let index = 0; index < template.length; index += 1) {
    const character = template[index];
    if (tagStart < 0) {
      if (character === '<') tagStart = index;
      continue;
    }
    if (quote) {
      if (character === quote && template[index - 1] !== '\\') quote = '';
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character !== '>') continue;
    const tag = template.slice(tagStart, index + 1);
    const plain = template.slice(cursor, tagStart).replace(/{{[\s\S]*?}}/g, mask);
    if (plain.trim()) candidates.push({ start: cursor, text: plain, strictOuter: true });
    for (const attribute of tag.matchAll(/(?<![:\w-])(?:title|aria-label|alt|placeholder|label|text|content)\s*=\s*(["'])([\s\S]*?)\1/gu)) {
      candidates.push({
        start: tagStart + (attribute.index ?? 0) + attribute[0].indexOf(/** @type {string} */ (attribute[2])),
        text: /** @type {string} */ (attribute[2]),
        strictOuter: true,
      });
    }
    cursor = index + 1;
    tagStart = -1;
  }
  const tail = template.slice(cursor).replace(/{{[\s\S]*?}}/g, mask);
  if (tail.trim()) candidates.push({ start: cursor, text: tail, strictOuter: true });
  if (scriptStart >= 0)
    candidates.push(
      ...quotedCandidates(text.slice(scriptStart)).map((item) => ({ ...item, start: item.start + scriptStart, strictOuter: false })),
    );
  return candidates;
}

/** @param {string} text @returns {TextCandidate[]} */
function quotedCandidates(text) {
  const candidates = [];
  const pattern = /(?:r#+"([\s\S]*?)"#+|`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\r\n])'|"(?:\\.|[^"\\])*")/gu;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const rawString = raw.startsWith('r');
    const prefix = rawString ? raw.indexOf('"') + 1 : 1;
    const suffix = rawString ? (raw.match(/"#*$/u)?.[0].length ?? 0) : 1;
    let content = raw.slice(prefix, raw.length - suffix);
    if (raw.startsWith('`')) content = content.replace(/\$\{[\s\S]*?\}/g, mask);
    content = content.replace(/\\[\s\S]/gu, mask);
    candidates.push({ start: (match.index ?? 0) + prefix, text: content });
  }
  return candidates;
}

/** @param {string} rel @param {string} source @param {TextCandidate} candidate @param {string[]} failures */
function scanCandidate(rel, source, candidate, failures) {
  for (const match of candidate.text.matchAll(BANNED_PUNCTUATION)) {
    report(
      rel,
      source,
      candidate.start + (match.index ?? 0),
      'text.punctuation',
      `中文标点 ${match[0]} 不允许出现在可见文字中，改为对应英文标点`,
      failures,
    );
  }
  const boundary = new RegExp(`${CJK}${LATIN}|${LATIN}${CJK}`, 'gu');
  for (const match of candidate.text.matchAll(boundary)) {
    report(
      rel,
      source,
      candidate.start + (match.index ?? 0),
      'text.cjk-latin-space',
      'CJK 字符与英文字符序列之间必须有一个 ASCII 空格',
      failures,
    );
  }
  const checkOuterSpace = candidate.strictOuter || /\p{Script=Han}/u.test(candidate.text);
  if (!checkOuterSpace) return;
  const quoteOpen = new Map();
  for (let index = 0; index < candidate.text.length; index += 1) {
    const character = candidate.text.charAt(index);
    const apostrophe =
      character === "'" && /[A-Za-z0-9]/u.test(candidate.text[index - 1] ?? '') && /[A-Za-z0-9]/u.test(candidate.text[index + 1] ?? '');
    if (!['"', "'", '(', ')'].includes(character) || apostrophe) continue;
    if (character === '(' && isFunctionCallOpening(candidate.text, index)) continue;
    const opening = character === '(' || ((character === '"' || character === "'") && !quoteOpen.get(character));
    const direction = opening ? -1 : 1;
    if (character === '"' || character === "'") quoteOpen.set(character, !quoteOpen.get(character));
    if (!outerSpaceIsValid(candidate.text, index, direction))
      report(rel, source, candidate.start + index, 'text.outer-space', '英文引号或圆括号与相邻文字之间必须有一个 ASCII 空格', failures);
  }
}

/** @param {string} text @param {number} index */
function isFunctionCallOpening(text, index) {
  return /(?:^|[^A-Za-z0-9_$-])[A-Za-z_$][A-Za-z0-9_$-]*$/u.test(text.slice(0, index));
}

/** @param {string} value */
function mask(value) {
  return MASK_CHAR.repeat(value.length);
}

/** @param {string} text @param {number} index @param {number} direction */
function outerSpaceIsValid(text, index, direction) {
  const adjacent = text[index + direction];
  if (adjacent === undefined || /\s|\p{P}|\p{S}/u.test(adjacent)) return true;
  if (adjacent !== ' ') return false;
  return text[index + direction * 2] !== ' ';
}

/** @param {string} rel @param {string} source @param {number} offset @param {string} rule @param {string} message @param {string[]} failures */
function report(rel, source, offset, rule, message, failures) {
  const prefix = source.slice(0, offset);
  failures.push(`${rel}:${prefix.split('\n').length}:${prefix.slice(prefix.lastIndexOf('\n') + 1).length + 1} ${rule}: ${message}`);
}
