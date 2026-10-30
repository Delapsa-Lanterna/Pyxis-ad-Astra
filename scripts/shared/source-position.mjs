/** @param {string} text @returns {(offset: number) => {line: number, column: number}} */
export function sourcePositions(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index++) if (text[index] === '\n') starts.push(index + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (/** @type {number} */ (starts[middle]) <= offset) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: offset - /** @type {number} */ (starts[low]) + 1 };
  };
}
