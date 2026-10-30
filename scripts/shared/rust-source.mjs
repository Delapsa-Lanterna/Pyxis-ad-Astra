/** @param {string} text @returns {string} */
export function productionRustSource(text) {
  return stripRustTestBlocks(stripRustCommentsAndStrings(text));
}

/** @param {string} value @returns {string[]} */
export function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index++) {
    if ('([{<'.includes(value.charAt(index))) depth++;
    if (')]}>'.includes(value.charAt(index))) depth--;
    if (value[index] === ',' && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

/** Masks non-code characters while preserving original source offsets.
 * @param {string} text @returns {string}
 */
export function stripRustCommentsAndStrings(text) {
  const output = text.split('');
  const rawString = /b?r(#*)"/y;
  let index = 0;
  while (index < text.length) {
    const start = index;
    if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index);
      index = end < 0 ? text.length : end;
    } else if (text.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (index < text.length && depth) {
        if (text.startsWith('/*', index)) {
          depth++;
          index += 2;
        } else if (text.startsWith('*/', index)) {
          depth--;
          index += 2;
        } else index++;
      }
    } else {
      rawString.lastIndex = index;
      const raw = text[index] === 'r' || text[index] === 'b' ? rawString.exec(text) : null;
      if (raw) {
        const delimiter = '"' + raw[1];
        const end = text.indexOf(delimiter, index + raw[0].length);
        index = end < 0 ? text.length : end + delimiter.length;
      } else if (text[index] === "'" && /^[A-Za-z_][A-Za-z0-9_]*(?!')/.test(text.slice(index + 1, index + 33))) {
        index += 1 + (/^[A-Za-z_][A-Za-z0-9_]*(?!')/.exec(text.slice(index + 1, index + 33))?.[0].length ?? 0);
        continue;
      } else if (
        text[index] === '"' ||
        (text[index] === "'" && /^'(?:\\(?:u\{[^}]+\}|x[\da-fA-F]{2}|.)|[^'\\\r\n])'/u.test(text.slice(index)))
      ) {
        const quote = text[index++];
        while (index < text.length) {
          if (text[index] === '\\') index += 2;
          else if (text[index++] === quote) break;
        }
      } else {
        index++;
        continue;
      }
    }
    for (let offset = start; offset < index; offset++) if (text[offset] !== '\n' && text[offset] !== '\r') output[offset] = ' ';
  }
  return output.join('');
}

/** @param {string} text @returns {string} */
export function stripRustTestBlocks(text) {
  const output = text.split('');
  for (const match of text.matchAll(/#!?\[cfg\(test\)\]|#\[(?:[A-Za-z_][A-Za-z0-9_]*::)?test(?:\([^]]*\))?\]/g)) {
    let end = match.index + match[0].length;
    let depth = 0;
    for (; end < text.length; end++) {
      if ('(['.includes(text.charAt(end))) depth++;
      else if (')]'.includes(text.charAt(end))) depth--;
      else if (!depth && (text[end] === '{' || text[end] === ';')) break;
    }
    if (match[0].startsWith('#!')) end = text.length;
    else if (text[end] === '{') {
      depth = 1;
      while (++end < text.length && depth) {
        if (text[end] === '{') depth++;
        if (text[end] === '}') depth--;
      }
    }
    for (let index = match.index; index <= end && index < text.length; index++)
      if (text[index] !== '\n' && text[index] !== '\r') output[index] = ' ';
  }
  return output.join('');
}
