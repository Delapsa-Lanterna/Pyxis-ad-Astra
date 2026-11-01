export type CsvCellEdit = { kind: 'raw'; text?: string; offsetX?: number } | { kind: 'picker' };

export function focusCsvCellText(input: HTMLInputElement | HTMLTextAreaElement, offsetX?: number) {
  input.focus({ preventScroll: true });
  let position = input.value.length;
  if (offsetX !== undefined) {
    // Hit-test the raw first line because smart labels can differ from stored IDs.
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = getComputedStyle(input).font;
    const text = input.value.split('\n')[0]!;
    let left = 0,
      right = text.length;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      const center = (context.measureText(text.slice(0, middle)).width + context.measureText(text.slice(0, middle + 1)).width) / 2;
      if (offsetX < center) right = middle;
      else left = middle + 1;
    }
    position = left;
  }
  input.setSelectionRange(position, position);
}
