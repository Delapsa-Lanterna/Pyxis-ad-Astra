import { AppError } from '@/shared/lib/errors';

export function renderCsvClipboard(rows: string[][]): string {
  return (
    rows
      .map((row) => row.map((value) => (/[\t\r\n"]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value)).join('\t'))
      .join('\r\n') + '\r\n'
  );
}

export function parseCsvClipboard(text: string): string[][] {
  // Spreadsheet quotes protect embedded tabs and line endings inside one cell.
  const rows: string[][] = [],
    row: string[] = [];
  let value = '',
    quoted = false,
    closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          value += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += char;
    } else if (char === '\t' || char === '\r' || char === '\n') {
      row.push(value);
      value = '';
      closed = false;
      if (char !== '\t') {
        rows.push(row.splice(0));
        if (char === '\r' && text[index + 1] === '\n') index++;
      }
    } else if (char === '"' && value === '' && !closed) quoted = true;
    else {
      if (closed) throw new AppError('粘贴内容的引号后包含额外文字');
      value += char;
    }
  }
  if (quoted) throw new AppError('粘贴内容的引号未闭合');
  if (row.length || value || closed || !rows.length || !/[\r\n]$/.test(text)) rows.push([...row, value]);
  const width = Math.max(...rows.map((entry) => entry.length));
  return rows.map((entry) => Array.from({ length: width }, (_, index) => entry[index] ?? ''));
}
