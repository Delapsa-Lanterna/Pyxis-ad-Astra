import { describe, expect, it } from 'vitest';
import { floatBits, floatValue, readGameInteger, readGameNumber } from './game-number';
import { convertSchemaScalarInput } from './schema-values';
import { prepareCsvValue } from './csv-value-validation';

describe('game numeric input rules', () => {
  it.each(['2', '2.0', '2f', '2D', '2e0', '0x1p1'])('interprets %s for integer and float edits', (raw) => {
    expect(readGameNumber(raw)).toBe(2);
    expect(readGameInteger(raw)).toBe(2);
    for (const type of ['integer', 'float'] as const)
      expect(convertSchemaScalarInput(raw, { key: 'value', label: 'Value', type })).toEqual({ kind: 'set', value: 2 });
  });
  it.each(['2wrong', '1.0000000000000001', '9007199254740993', '9.99'])('rejects %s as a safe integer edit', (raw) => {
    expect(readGameInteger(raw)).toBeNull();
  });
  it('passes an exact finite float representation through the wire', () => {
    for (const value of [0, 0.1, Number.MIN_VALUE, Number.MAX_VALUE]) expect(floatValue(floatBits(value))).toBe(value);
    expect(floatValue(floatBits(-0))).toBe(0);
  });
  it('normalizes only the submitted CSV value using its declared format', () => {
    expect(prepareCsvValue({ key: 'count', control: 'number', valueType: 'integer' }, '999')).toBe('999');
    expect(() => prepareCsvValue({ key: 'count', control: 'number', valueType: 'integer' }, '9.99')).toThrow();
    expect(prepareCsvValue({ key: 'amount', control: 'number', valueType: 'float' }, '9')).toBe('9.0');
    expect(prepareCsvValue({ key: 'amount', control: 'number', valueType: 'float' }, '1e22')).toBe('1e+22');
  });
});
