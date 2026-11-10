import type { FileValue, JsonFileWrite, JsonTarget, OutputFormat, PreparedFileValue } from '@/shared/types';
import type { FieldSchema } from './schema.types';

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const HEX = /^([+-]?)0x([\da-f]*\.?[\da-f]+|[\da-f]+\.?)p([+-]?\d+)$/i;
export function readGameNumber(input: string): number | null {
  const text = input.trim().replace(/[fFdD]$/, '');
  if (DECIMAL.test(text)) {
    const value = Number(text);
    return Number.isFinite(value) ? (value === 0 ? 0 : value) : null;
  }
  const match = HEX.exec(text);
  if (!match) return null;
  const mantissa = match[2]!,
    point = mantissa.indexOf('.');
  const digits = mantissa.replace('.', '').replace(/^0+/, '');
  if (!digits) return 0;
  const integer = BigInt(`0x${digits}`),
    length = integer.toString(2).length;
  const exponent = Number(match[3]) - (point < 0 ? 0 : (mantissa.length - point - 1) * 4);
  const high = length - 1 + exponent;
  if (high > 1023) return null;
  if (high < -1075) return 0;
  const precision = high >= -1022 ? 53 : high + 1075;
  const shift = Math.max(0, length - precision);
  let significant = integer >> BigInt(shift);
  if (shift > 0) {
    const remainder = integer - (significant << BigInt(shift)),
      half = 1n << BigInt(shift - 1);
    if (remainder > half || (remainder === half && (significant & 1n) === 1n)) significant++;
  }
  const result = Number(significant) * 2 ** (exponent + shift);
  const signed = match[1] === '-' ? -result : result;
  return Number.isFinite(signed) ? (signed === 0 ? 0 : signed) : null;
}
export function readGameInteger(input: string): number | null {
  const text = input.trim().replace(/[fFdD]$/, '');
  if (HEX.test(text)) {
    const value = readGameNumber(input);
    return value !== null && Number.isSafeInteger(value) ? value : null;
  }
  if (!DECIMAL.test(text)) return null;
  const negative = text.startsWith('-'),
    unsigned = text.replace(/^[+-]/, '');
  const [mantissa, power = '0'] = unsigned.split(/[eE]/),
    [whole = '', fraction = ''] = mantissa!.split('.');
  let digits = `${whole}${fraction}`.replace(/^0+/, '');
  if (!digits) return 0;
  const scale = Number(power) - fraction.length;
  if (scale < 0) {
    if (-scale > digits.length || !/^0*$/.test(digits.slice(digits.length + scale))) return null;
    digits = digits.slice(0, digits.length + scale);
  } else {
    if (scale > 16 || digits.length + scale > 16) return null;
    digits += '0'.repeat(scale);
  }
  const value = Number(`${negative ? '-' : ''}${digits}`);
  return Number.isSafeInteger(value) ? value : null;
}
export function floatBits(value: number): string {
  const buffer = new ArrayBuffer(8),
    view = new DataView(buffer);
  view.setFloat64(0, value === 0 ? 0 : value, false);
  return view.getBigUint64(0, false).toString(16).padStart(16, '0');
}
export function floatValue(bits: string): number {
  const buffer = new ArrayBuffer(8),
    view = new DataView(buffer);
  view.setBigUint64(0, BigInt(`0x${bits}`), false);
  return view.getFloat64(0, false);
}
export function generatedTarget(output: OutputFormat = 'value'): JsonTarget {
  return { source: null, output, children: null };
}
export function prepareNumber(value: number, format: 'integer' | 'float'): PreparedFileValue {
  return {
    value: format === 'integer' ? { kind: 'integer', value: String(value) } : { kind: 'float', value: floatBits(value) },
    target: generatedTarget(format),
  };
}
export function prepareValue(value: unknown): PreparedFileValue {
  let content: FileValue;
  if (value === null) content = { kind: 'null' };
  else if (typeof value === 'boolean') content = { kind: 'bool', value };
  else if (typeof value === 'string') content = { kind: 'text', value };
  else if (typeof value === 'number') return prepareNumber(value, Number.isInteger(value) ? 'integer' : 'float');
  else if (Array.isArray(value)) content = { kind: 'array', value: value.map((item) => prepareValue(item).value) };
  else if (value && typeof value === 'object')
    content = { kind: 'object', value: Object.entries(value).map(([key, item]) => [key, prepareValue(item).value]) };
  else throw new Error('File data requires an explicit value');
  return { value: content, target: generatedTarget() };
}
export function prepareJsonWrite(value: unknown): JsonFileWrite {
  const prepared = prepareValue(value);
  return { content: prepared.value, target: prepared.target, layout: 'expanded' };
}
export function prepareSchemaValue(value: unknown, field: FieldSchema): PreparedFileValue {
  if (field.type === 'integer' || field.type === 'float') {
    const parsed = field.type === 'integer' ? readGameInteger(String(value)) : readGameNumber(String(value));
    if (parsed === null) return prepareValue(value);
    return prepareNumber(parsed, field.type);
  }
  if (field.type === 'array' && Array.isArray(value) && field.item) {
    const items = value.map((item) => prepareSchemaValue(item, field.item!));
    return {
      value: { kind: 'array', value: items.map((item) => item.value) },
      target: { ...generatedTarget(), children: { kind: 'array', items: items.map((item) => item.target) } },
    };
  }
  if (field.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const items = Object.entries(value).map(([key, value]): [string, PreparedFileValue] => {
      const child = field.nested?.find((item) => item.key === key) ?? field.valueSchema;
      return [key, child ? prepareSchemaValue(value, child) : prepareValue(value)];
    });
    return {
      value: { kind: 'object', value: items.map(([key, item]) => [key, item.value]) },
      target: { ...generatedTarget(), children: { kind: 'object', items: items.map(([key, item]) => [key, item.target]) } },
    };
  }
  return prepareValue(value);
}
