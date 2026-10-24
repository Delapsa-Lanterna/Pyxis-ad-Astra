export function stableDeepEqual<T>(left: T, right: T, ordered = false): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object')
    return JSON.stringify(left) === JSON.stringify(right);
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) if (!stableDeepEqual(left[index], right[index], ordered)) return false;
    return true;
  }
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  const keys = Object.keys(a),
    other = Object.keys(b);
  return (
    keys.length === other.length &&
    keys.every((key, index) => (!ordered || key === other[index]) && Object.hasOwn(b, key) && stableDeepEqual(a[key], b[key], ordered))
  );
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
