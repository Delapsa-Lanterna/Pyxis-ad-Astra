import { effectScope, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useSnapshotHistory } from './use-snapshot-history';
import type { EditContext } from '@/shared/types';

function harness<T>(limit = 2) {
  const scope = effectScope();
  const context = ref<EditContext | null>({ targetKey: 'one', baselineGeneration: 1, handoff: 'load' });
  const capacity = ref(limit);
  const history = scope.run(() => useSnapshotHistory<T>(context, capacity))!;
  return { scope, context, history, capacity };
}

describe('snapshot history context', () => {
  it('applies capacity changes immediately, retains redo and releases its watcher', () => {
    const { history, scope, capacity } = harness<number>(4);
    for (let value = 0; value < 4; value++) history.push(value, value + 1);
    expect(history.undo()).toBe(3);
    capacity.value = 1;
    expect(history.undo()).toBe(2);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBe(3);
    expect(history.redo()).toBe(4);
    capacity.value = 3;
    history.push(4, 5);
    history.push(5, 6);
    expect(history.undo()).toBe(5);
    expect(history.undo()).toBe(4);
    scope.stop();
    capacity.value = 1;
    expect(history.undo()).toBe(3);
  });
  it('rebases both directions during an identity handoff', () => {
    const { history, scope, context } = harness<{ id: string; value: number }>();
    history.push({ id: 'old', value: 1 }, { id: 'old', value: 2 });
    context.value = { targetKey: 'new', baselineGeneration: 2, handoff: 'identity' };
    history.rebase((value) => ({ ...value, id: 'new' }));
    expect(history.undo()).toEqual({ id: 'new', value: 1 });
    expect(history.redo()).toEqual({ id: 'new', value: 2 });
    scope.stop();
  });
  it('records text before and after, ignores equal actions and clears redo on a new edit', () => {
    const { history, scope } = harness<string>();
    history.push('a', 'a');
    expect(history.canUndo.value).toBe(false);
    history.push('a', 'b');
    history.push('b', 'c');
    expect(history.undo()).toBe('b');
    expect(history.redo()).toBe('c');
    expect(history.undo()).toBe('b');
    history.push('b', 'd');
    expect(history.canRedo.value).toBe(false);
    expect(history.undo()).toBe('b');
    expect(history.undo()).toBe('a');
    expect(history.undo()).toBeNull();
    scope.stop();
  });
  it('clones object actions and trims to the consumer capacity', () => {
    const { history, scope } = harness<{ slots: number[] }>();
    const before = { slots: [1] };
    const after = { slots: [1, 2] };
    history.push(before, after);
    before.slots.push(9);
    after.slots.push(9);
    expect(history.undo()).toEqual({ slots: [1] });
    expect(history.redo()).toEqual({ slots: [1, 2] });
    history.push({ slots: [1, 2] }, { slots: [3] });
    history.push({ slots: [3] }, { slots: [4] });
    expect(history.undo()).toEqual({ slots: [3] });
    expect(history.undo()).toEqual({ slots: [1, 2] });
    expect(history.undo()).toBeNull();
    scope.stop();
  });
  it('retains history across a local save and its identity handoff', () => {
    const { history, context, scope } = harness<string>();
    history.push('a', 'b');
    context.value = { targetKey: 'renamed', baselineGeneration: 2, handoff: 'save' };
    history.push('b', 'c');
    expect(history.undo()).toBe('b');
    expect(history.undo()).toBe('a');
    scope.stop();
  });
  it.each(['load', 'external', 'reset'] as const)('clears both stacks on %s even for equal business content', (handoff) => {
    const { history, context, scope } = harness<string>();
    history.push('a', 'b');
    history.undo();
    context.value = { targetKey: 'one', baselineGeneration: 2, handoff };
    expect(history.canUndo.value).toBe(false);
    expect(history.canRedo.value).toBe(false);
    scope.stop();
  });
});
