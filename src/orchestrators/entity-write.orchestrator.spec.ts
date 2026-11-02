import { dialogText, selectDialogOption } from '@/test/unit/dialog-text';
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
    [{ inherits: true }, '基础内容'],
  ] as const)('asks to keep the file name for %o', async (flags, reason) => {
    const source = entityTargetFixture('faction', 'sample');
    for (const [choice, expected] of [
      ['keep', true],
      [null, null],
    ] as const) {
      const choose = vi.fn<AppFeedback['choose']>(async (options) => {
        if (!('filenameTaken' in flags)) await selectDialogOption(options, '文件名处理', 'keep');
        return choice === 'keep' ? 'save' : null;
      });
      const feedback = { choose } as Pick<AppFeedback, 'choose'> as AppFeedback;
      expect(await chooseEntityFilename(feedback, source, intent('next', flags))).toBe(expected);
      const options = choose.mock.calls[0]![0];
      expect(dialogText(options)).toContain(source.write.relPath);
      expect(dialogText(options)).toContain(reason);
      expect(options.choices.map((entry) => entry.value)).toEqual(['save']);
    }
  });
  it('returns the rename decision for an inherited file with an available destination', async () => {
    const choose = vi.fn<AppFeedback['choose']>(async () => 'save');
    const feedback = { choose } as Pick<AppFeedback, 'choose'> as AppFeedback;
    expect(await chooseEntityFilename(feedback, entityTargetFixture('faction', 'sample'), intent('next', { inherits: true }))).toBe(false);
    expect(choose.mock.lastCall![0].choices.map((choice) => choice.label)).toEqual(['保存']);
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
      expect(dialogText(choose.mock.calls[0]![0])).toContain(change.target.write.relPath);
      expect(choose.mock.calls[0]![0].choices.map((item) => item.label)).toEqual(['保存']);
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
    await confirmEntityIdChanges(feedback, [{ target, before: { id: 'sample' }, after: {}, composition }]);
    expect(dialogText(choose.mock.lastCall![0])).toContain('沿用基础来源提供的 base');
    await confirmEntityIdChanges(feedback, [{ target, before: { id: 'sample' }, after: { id: '' }, composition }]);
    expect(dialogText(choose.mock.lastCall![0])).toContain('空字符串会写入文件，并覆盖基础来源中的 ID base');
  });
});
