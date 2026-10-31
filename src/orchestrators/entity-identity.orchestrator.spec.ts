import { describe, it, expect, vi } from 'vitest';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import type { AppFeedback } from '@/shared/types';
import { chooseIdentityFilename } from './entity-identity.orchestrator';

describe('identity filename confirmation', () => {
  it.each([
    ['rename', false],
    ['keep', true],
    [null, null],
  ] as const)('returns %s with captured old and new paths', async (choice, expected) => {
    const source = entityTargetFixture('faction', 'sample');
    const choose = vi.fn<AppFeedback['choose']>(async () => choice);
    const feedback = { choose } as Pick<AppFeedback, 'choose'> as AppFeedback;
    expect(await chooseIdentityFilename(feedback, source, 'next')).toBe(expected);
    expect(choose).toHaveBeenCalledOnce();
    const options = choose.mock.calls[0]![0];
    expect(options.content).toContain(source.write.relPath);
    expect(options.content).toContain('next.faction');
    expect(options.choices.map((entry) => entry.value)).toEqual(['rename', 'keep']);
  });
  it('keeps same-ID saves free of a rename prompt', async () => {
    const source = entityTargetFixture('faction', 'sample');
    const choose = vi.fn<AppFeedback['choose']>(async () => 'rename');
    expect(await chooseIdentityFilename({ choose } as Pick<AppFeedback, 'choose'> as AppFeedback, source, 'sample')).toBe(false);
    expect(choose).not.toHaveBeenCalled();
  });
});
