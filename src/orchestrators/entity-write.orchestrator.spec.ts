import { describe, it, expect, vi } from 'vitest';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import type { AppFeedback, EntityIdentityIntent } from '@/shared/types';
import { confirmEntityIdChanges, chooseEntityFilename } from './entity-write.orchestrator';

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
      expect(options.choices.map((entry) => entry.value)).toEqual('filenameTaken' in flags ? ['keep'] : ['rename', 'keep']);
    }
  });
  it('returns the rename decision for an inherited file with an available destination', async () => {
    const choose = vi.fn<AppFeedback['choose']>(async () => 'rename');
    const feedback = { choose } as Pick<AppFeedback, 'choose'> as AppFeedback;
    expect(await chooseEntityFilename(feedback, entityTargetFixture('faction', 'sample'), intent('next', { inherits: true }))).toBe(false);
    expect(choose.mock.lastCall![0].choices.map((choice) => choice.label)).toEqual(['更改文件名', '保留文件名']);
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

describe('local identity presence confirmation', () => {
  it.each([
    [false, false],
    [true, true],
    [false, true],
    [true, false],
  ])('compares local presence %s -> %s', async (beforeId, afterId) => {
    const choose = vi.fn<AppFeedback['choose']>(async () => 'save');
    const feedback = { choose } as Pick<AppFeedback, 'choose'> as AppFeedback;
    const change: Parameters<typeof confirmEntityIdChanges>[1][number] = {
      target: entityTargetFixture('faction', 'sample'),
      before: beforeId ? { id: 'sample' } : {},
      after: afterId ? { id: 'next' } : {},
      composition: { layers: [], excluded: [], replace: false },
    };
    expect(await confirmEntityIdChanges(feedback, [change, change])).toBe(true);
    expect(choose).toHaveBeenCalledTimes(Number(beforeId !== afterId));
    if (beforeId !== afterId) {
      expect(choose.mock.calls[0]![0].content).toContain(change.target.write.relPath);
      expect(choose.mock.calls[0]![0].choices.map((item) => item.label)).toEqual(['确认变化并保存', '返回编辑']);
      choose.mockResolvedValueOnce('cancel');
      expect(await confirmEntityIdChanges(feedback, [change])).toBe(false);
    }
  });
  it('reports inherited and explicitly empty identities from the composed contents', async () => {
    const choose = vi.fn<AppFeedback['choose']>(async () => 'save');
    const feedback = { choose } as Pick<AppFeedback, 'choose'> as AppFeedback;
    const target = entityTargetFixture('faction', 'sample');
    const composition = {
      layers: [
        {
          source: { ...target.write, source: 'core' as const },
          version: { path: target.write.path, fingerprint: 'base' },
          data: { id: 'base' },
          replace: false,
        },
      ],
      excluded: [],
      replace: false,
    };
    await confirmEntityIdChanges(feedback, [{ target, before: { id: 'sample' }, after: {}, composition, keepFilename: true }]);
    expect(choose.mock.lastCall![0].content).toContain('基础来源 ID：base；组合后的 ID：base');
    await confirmEntityIdChanges(feedback, [{ target, before: { id: 'sample' }, after: { id: '' }, composition, keepFilename: true }]);
    expect(choose.mock.lastCall![0].content).toContain('组合后的 ID：未提供');
  });
});
