import { describe, it, expect, vi } from 'vitest';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import type { AppFeedback, EntityIdentityIntent } from '@/shared/types';
import { chooseEntityFilename } from './entity-write.orchestrator';

function intent(nextId: string, flags: Pick<EntityIdentityIntent, 'filenameTaken' | 'inherits'> = {}) {
  return { nextId, nextWrite: entityTargetFixture('faction', nextId).write, ...flags };
}

describe('identity filename choice', () => {
  it('renames without asking when nothing conflicts', async () => {
    const choose = vi.fn<AppFeedback['choose']>();
    const feedback = { choose } as Pick<AppFeedback, 'choose'> as AppFeedback;
    expect(await chooseEntityFilename(feedback, entityTargetFixture('faction', 'sample'), intent('next'))).toBe(false);
    expect(choose).not.toHaveBeenCalled();
  });
  it.each([
    [{ filenameTaken: true }, 'next.faction'],
    [{ inherits: true }, '同路径组合'],
  ] as const)('asks to keep the file name for %o', async (flags, reason) => {
    const source = entityTargetFixture('faction', 'sample');
    for (const [choice, expected] of [
      ['keep', true],
      [null, null],
    ] as const) {
      const choose = vi.fn<AppFeedback['choose']>(async () => choice);
      const feedback = { choose } as Pick<AppFeedback, 'choose'> as AppFeedback;
      expect(await chooseEntityFilename(feedback, source, intent('next', flags))).toBe(expected);
      const options = choose.mock.calls[0]![0];
      expect(options.content).toContain(source.write.relPath);
      expect(options.content).toContain(reason);
      expect(options.choices.map((entry) => entry.value)).toEqual(['keep']);
    }
  });
  it('keeps same-ID saves free of a prompt', async () => {
    const choose = vi.fn<AppFeedback['choose']>();
    const feedback = { choose } as Pick<AppFeedback, 'choose'> as AppFeedback;
    expect(await chooseEntityFilename(feedback, entityTargetFixture('faction', 'sample'), intent('sample', { inherits: true }))).toBe(
      false,
    );
    expect(choose).not.toHaveBeenCalled();
  });
});
