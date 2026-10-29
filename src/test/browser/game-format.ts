export function readGameCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  const input = text.replaceAll('\r\n', '\n');
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (char === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      row.push(cell);
      cell = '';
      if (char === '\n') {
        records.push(row);
        row = [];
      }
    } else cell += char;
  }
  if (cell || row.length) records.push([...row, cell]);
  const header = records.shift()!;
  return {
    header,
    rows: records
      .filter((values) => values.some(Boolean) && !values[0]!.startsWith('#'))
      .map((values) => Object.fromEntries(header.map((key, i) => [key, values[i] ?? '']))),
  };
}

export function renderGameCsv(header: string[], rows: Record<string, string>[]) {
  const cell = (value: string) => (/[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value);
  return [header, ...rows.map((row) => header.map((key) => row[key] ?? ''))].map((values) => values.map(cell).join(',')).join('\n') + '\n';
}
