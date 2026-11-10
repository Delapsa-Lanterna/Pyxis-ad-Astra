import { describe, expect, it } from 'vitest';
import { captureJsonEdits } from './json-edits';
describe('semantic JSON edits', () => {
  it('tracks nested changes and treats a collection as one business value', () => {
    expect(
      captureJsonEdits({ nested: { before: 1, kept: 2 }, items: [1, 1, 2] }, { nested: { kept: 2, after: 3 }, items: [1, 2] }),
    ).toEqual([
      { kind: 'remove', path: ['nested', 'before'] },
      { kind: 'set', path: ['nested', 'after'], value: 3 },
      { kind: 'set', path: ['items'], value: [1, 2] },
    ]);
  });
});
