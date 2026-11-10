import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { createFieldInputs, type FieldInput } from './field-inputs';
import { appLogQueue } from './app-log-queue';
import type { AppLogEntry } from '@/shared/types';

function field(key: string, commit: FieldInput['commit']): FieldInput {
  return { key, label: key, dirty: ref(true), commit, focus: vi.fn(), cancel: vi.fn() };
}

describe('target field input lifecycle', () => {
  it.each(['cancel', 'release', 'retarget'] as const)(
    'rejects a settled finalizer after %s before accepting its contents',
    async (action) => {
      const key = ref('sample'),
        inputs = createFieldInputs(key),
        accepted = vi.fn();
      let finish!: () => void;
      inputs.registerFinalizer(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const pending = inputs.commit(undefined, true, accepted);
      if (action === 'retarget') key.value = 'other';
      else inputs[action]();
      finish();
      expect(await pending).toBe(false);
      expect(accepted).toHaveBeenCalledTimes(0);
      inputs.release();
    },
  );
  it('focuses the registered path without committing raw input and stops locating released fields', async () => {
    const inputs = createFieldInputs();
    const registered = {
      ...field(
        'stable-key',
        vi.fn(() => null),
      ),
      path: 'groups[1].name',
    };
    const remove = inputs.register(registered);
    await inputs.focus(registered.path);
    expect(registered.focus).toHaveBeenCalledOnce();
    expect(registered.commit).not.toHaveBeenCalled();
    expect(registered.dirty.value).toBe(true);
    remove();
    await inputs.focus(registered.path);
    expect(registered.focus).toHaveBeenCalledOnce();
    inputs.release();
  });
  it('records commit, rejection, cancellation and release without field values', async () => {
    const records: AppLogEntry[] = [];
    appLogQueue.install(async (entries) => {
      records.push(...entries);
    }, vi.fn());
    appLogQueue.setLevel('debug');
    try {
      const inputs = createFieldInputs(ref('fixture'));
      const good = field('good', () => null);
      const remove = inputs.register(good);
      await inputs.commit();
      remove();
      const bad = field('bad', () => 'private validation');
      inputs.register(bad);
      await expect(inputs.commit()).rejects.toThrow('private validation');
      expect(bad.focus).toHaveBeenCalledOnce();
      inputs.cancel();
      inputs.release();
      await appLogQueue.flush();
      expect(records.map((record) => record.code)).toEqual([
        'input.registered',
        'input.committed',
        'input.released',
        'input.registered',
        'input.validation_failed',
        'input.cancelled',
        'input.cancelled',
      ]);
      expect(records[4]!.fields).toMatchObject({ target: 'fixture', field: 'bad', error: 'private validation' });
    } finally {
      appLogQueue.setLevel('info');
    }
  });
  it('awaits finalizers and stops the save continuation on explicit rejection', async () => {
    const inputs = createFieldInputs(ref('one'));
    let finish!: (value: boolean) => void;
    const after = vi.fn();
    inputs.registerFinalizer(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
      'manual',
    );
    inputs.registerFinalizer(after);
    const commit = inputs.commit();
    expect(after).not.toHaveBeenCalled();
    finish(false);
    expect(await commit).toBe(false);
    expect(after).not.toHaveBeenCalled();
  });
  it('revokes a late async finalizer after target changes', async () => {
    const target = ref('one'),
      inputs = createFieldInputs(target);
    let finish!: () => void;
    inputs.registerFinalizer(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const commit = inputs.commit();
    target.value = 'two';
    finish();
    expect(await commit).toBe(false);
  });
  it('preserves action acceptance across commit and revokes it on explicit cancellation', async () => {
    const inputs = createFieldInputs();
    const accepts = inputs.captureContext();
    inputs.register(field('first', () => null));
    await inputs.commit();
    expect(accepts()).toBe(true);
    inputs.cancel();
    expect(accepts()).toBe(false);
  });
  it('commits in registration order and waits for consumer projections', async () => {
    const inputs = createFieldInputs(ref('one'));
    const preview = ref('base');
    const observed: string[] = [];
    inputs.register(
      field('first', () => {
        preview.value = 'first';
        return null;
      }),
    );
    inputs.register(
      field('second', () => {
        observed.push(preview.value);
        return null;
      }),
    );
    await inputs.commit();
    expect(observed).toEqual(['first']);
  });

  it('preserves successful fields and focuses the first rejected field', async () => {
    const inputs = createFieldInputs(ref('one'));
    const first = field(
      'first',
      vi.fn(() => null),
    );
    const second = field(
      'second',
      vi.fn(() => '请输入 JSON 对象'),
    );
    const third = field(
      'third',
      vi.fn(() => null),
    );
    [first, second, third].forEach(inputs.register);
    await expect(inputs.commit()).rejects.toMatchObject({ action: 'commit-field-inputs', message: 'second：请输入 JSON 对象' });
    expect(first.commit).toHaveBeenCalledTimes(1);
    expect(second.focus).toHaveBeenCalledTimes(1);
    expect(third.commit).not.toHaveBeenCalled();
  });

  it('revokes pending acceptance when the edit target changes', async () => {
    const target = ref('one');
    const inputs = createFieldInputs(target);
    const later = field(
      'later',
      vi.fn(() => null),
    );
    inputs.register(
      field('first', () => {
        target.value = 'two';
        return null;
      }),
    );
    inputs.register(later);
    await inputs.commit();
    expect(later.commit).not.toHaveBeenCalled();
  });

  it('cancels only the removed field subtree and releases registrations', async () => {
    const inputs = createFieldInputs();
    const nested = field('array/row/field', () => null);
    const other = field('array/another/field', () => null);
    const unregister = inputs.register(nested);
    inputs.register(other);
    inputs.cancel('array/row');
    expect(nested.cancel).toHaveBeenCalledTimes(1);
    expect(other.cancel).not.toHaveBeenCalled();
    unregister();
    await nextTick();
    inputs.release();
    expect(inputs.dirty.value).toBe(false);
    expect(inputs.commit()).toBeUndefined();
  });
});
