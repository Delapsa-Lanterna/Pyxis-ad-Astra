export function nextFormattedId(used: ReadonlySet<string>, format: (index: number) => string, scanLimit = 9999): string {
  for (let index = 1; index <= scanLimit; index += 1) {
    const id = format(index);
    if (!used.has(id)) return id;
  }
  return format(scanLimit + 1);
}
