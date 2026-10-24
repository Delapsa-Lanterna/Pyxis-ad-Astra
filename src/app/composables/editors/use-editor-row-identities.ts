import { ref, watch } from 'vue';
import { stableStringify } from '@/shared/lib/stable-compare';

export function useEditorRowIdentities(rows: () => unknown[], key?: (value: unknown) => unknown) {
  const identities = ref<number[]>([]);
  let sequence = 0;
  let previous: unknown[] = [];
  const signatures = (items: unknown[]) => items.map(key ?? stableStringify);
  watch(
    rows,
    (next) => {
      const values = signatures(next);
      if (values.length === previous.length && values.every((value, index) => value === previous[index])) return;
      const buckets = new Map<unknown, { indices: number[]; cursor: number }>();
      previous.forEach((value, index) => {
        const bucket = buckets.get(value) ?? { indices: [], cursor: 0 };
        bucket.indices.push(index);
        buckets.set(value, bucket);
      });
      const used = new Set<number>();
      // Duplicate values consume earlier identities in their original order.
      identities.value = values.map((value, index) => {
        const bucket = buckets.get(value);
        while (bucket && bucket.cursor < bucket.indices.length && used.has(bucket.indices[bucket.cursor]!)) bucket.cursor++;
        const matched = bucket?.indices[bucket.cursor++];
        const at = matched ?? (!key && values.length === previous.length && !used.has(index) ? index : -1);
        used.add(at);
        return at >= 0 ? identities.value[at]! : ++sequence;
      });
      previous = values;
    },
    { immediate: true, flush: 'sync' },
  );
  function commit(next: unknown[], operation?: { kind: 'insert' | 'remove'; index: number }) {
    if (operation?.kind === 'insert') identities.value.splice(operation.index, 0, ++sequence);
    if (operation?.kind === 'remove') identities.value.splice(operation.index, 1);
    previous = signatures(next);
  }
  return { identities, commit };
}
