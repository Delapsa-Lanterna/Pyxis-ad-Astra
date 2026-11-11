import { expect, it } from 'vitest';
import { tabLabel } from './file-tabs';

it('distinguishes same-name file tabs', () => {
  expect(tabLabel('M:/src/a/Entry.java', ['M:/src/a/Entry.java', 'M:/src/b/Entry.java'], 'M:/src')).toBe('a/Entry.java');
  expect(tabLabel('M:/src/a/Entry.java', ['M:/src/a/Entry.java'], 'M:/src')).toBe('Entry.java');
});
