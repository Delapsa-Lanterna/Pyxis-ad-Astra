import { effectScope, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useEditorRowIdentities } from './use-editor-row-identities';

describe('collection row identities', () => {
  it('consumes duplicate values in order and retains unchanged positions during edits', () => {
    const scope = effectScope();
    const values = ref([1, 1, 2]);
    const rows = scope.run(() => useEditorRowIdentities(() => values.value))!;
    const initial = [...rows.identities.value];
    values.value = [1, 2, 1];
    expect(rows.identities.value).toEqual([initial[0], initial[2], initial[1]]);
    values.value = [3, 2, 1];
    expect(rows.identities.value).toEqual([initial[0], initial[2], initial[1]]);
    rows.commit([3, 1], { kind: 'remove', index: 1 });
    values.value = [3, 1];
    expect(rows.identities.value).toEqual([initial[0], initial[1]]);
    scope.stop();
  });
  it('tracks names through value cloning, insertion, renaming and reordering', () => {
    const scope = effectScope();
    const values = ref([
      { key: '组.一', value: 1 },
      { key: '_two', value: 2 },
    ]);
    const rows = scope.run(() =>
      useEditorRowIdentities(
        () => values.value,
        (value) => (value as { key: string }).key,
      ),
    )!;
    const initial = [...rows.identities.value];
    values.value = [
      { key: '_two', value: 3 },
      { key: '组.一', value: 4 },
    ];
    expect(rows.identities.value).toEqual([initial[1], initial[0]]);
    const renamed = [
      { key: '_two', value: 3 },
      { key: 'renamed', value: 4 },
    ];
    rows.commit(renamed);
    values.value = renamed;
    expect(rows.identities.value).toEqual([initial[1], initial[0]]);
    scope.stop();
  });
});
