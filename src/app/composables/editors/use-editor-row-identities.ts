import { ref, watch } from 'vue';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';

export function useEditorRowIdentities(rows: () => unknown[], key?: (value: unknown) => unknown) {
  const identities = ref<number[]>([]);
  let sequence = 0;
  let previous: unknown[] = [];

  watch(
    rows,
    (next) => {
      if (!stableDeepEqual(next, previous)) {
        const used = new Set<number>();
        identities.value = next.map((value, index) => {
          const matched = previous.findIndex((old, at) => !used.has(at) && (key ? key(old) === key(value) : stableDeepEqual(old, value)));
          const at = matched >= 0 ? matched : !key && next.length === previous.length && !used.has(index) ? index : -1;
          used.add(at);
          return at >= 0 ? identities.value[at]! : ++sequence;
        });
      }
      previous = deepClone(next);
    },
    { immediate: true, flush: 'sync' },
  );

  function commit(next: unknown[], operation?: { kind: 'insert' | 'remove'; index: number }) {
    if (operation?.kind === 'insert') identities.value.splice(operation.index, 0, ++sequence);
    if (operation?.kind === 'remove') identities.value.splice(operation.index, 1);
    previous = deepClone(next);
  }

  return { identities, commit };
}
