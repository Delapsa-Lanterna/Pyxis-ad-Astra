import { ref, onScopeDispose, watch } from 'vue';
import type { CsvGridModel } from '@/domain/csv-editor/csv-grid-model';
import { parseCsvClipboard, renderCsvClipboard } from '@/domain/csv-editor/csv-clipboard';
import { readClipboardText, writeClipboardText } from '@/shared/runtime/clipboard.runtime';
import { cell } from '@/shared/lib/starsector';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useCsvTableInputs } from './use-csv-table-inputs';
import type { useCsvRangeSelection } from './use-csv-range-selection';

type RangeCommand =
  | { kind: 'copy' | 'paste' | 'clear' | 'down' | 'right' | 'delete-rows' }
  | { kind: 'fill'; text: string; accept: () => void; current: () => boolean }
  | { kind: 'move-rows' | 'copy-rows'; keys: string[]; before: string; after: boolean }
  | { kind: 'insert-rows'; before: string };

export function useCsvRangeActions(options: {
  model: () => CsvGridModel;
  selection: ReturnType<typeof useCsvRangeSelection>;
  close: () => void;
}) {
  const context = useCsvTableInputs(),
    feedback = useAppFeedback(),
    busy = ref(false);
  let revision = 0;
  watch(
    () => [context.range?.revision(), context.range?.disabled(), options.model().rowKeys],
    () => revision++,
    { flush: 'sync' },
  );
  onScopeDispose(() => revision++);
  async function run(command: RangeCommand): Promise<void> {
    const action = command.kind;
    const b = options.selection.bounds.value,
      owner = context.range;
    if (!b || !owner || busy.value || owner.disabled()) return;
    const token = revision,
      selectionRevision = options.selection.revision.value;
    const current = () =>
      token === revision &&
      selectionRevision === options.selection.revision.value &&
      !owner.disabled() &&
      (command.kind !== 'fill' || command.current());
    const model = options.model(),
      visible = [...model.rowKeys],
      columns = model.columns.map((column) => column.key);
    let keys =
        'keys' in command
          ? [...command.keys]
          : options.selection.rowsMode.value
            ? [...options.selection.selectedRows.value]
            : visible.slice(b.top, b.bottom + 1),
      cols = columns.slice(b.left, b.right + 1);
    busy.value = true;
    try {
      if (command.kind !== 'fill' && (await context.inputs.commit()) === false) return;
      if (!current()) return;
      if (command.kind === 'move-rows') {
        owner.move(keys, owner.position(command.before, command.after));
        options.selection.setRows(keys);
        return;
      }
      let values: string[][];
      if (action === 'paste' || action === 'insert-rows') {
        values = parseCsvClipboard(await readClipboardText());
        if (!current()) return;
        const width = values[0]!.length;
        const left = action === 'insert-rows' ? 0 : b.left;
        if (width > columns.length - left) {
          feedback.error(`粘贴需要 ${width} 列，当前位置剩余 ${columns.length - left} 列`);
          return;
        }
        if (command.kind === 'insert-rows') {
          const written = owner.insert(columns, values, owner.position(command.before));
          options.close();
          options.selection.setRows(written);
          return;
        }
        keys = visible.slice(b.top, b.top + values.length);
        cols = columns.slice(b.left, b.left + width);
      } else values = [];
      let sources = [...keys];
      if (keys.length === 1 && cols.length === 1 && action === 'down') {
        if (b.top === 0) return;
        sources = [visible[b.top - 1]!];
      }
      if (!(await owner.load([...new Set([...keys, ...sources])]))) return;
      if (!current()) return;
      if (command.kind === 'copy-rows') {
        const copied = owner.copy(keys, owner.position(command.before, command.after));
        options.close();
        options.selection.setRows(copied);
        return;
      }
      if (action === 'delete-rows') {
        owner.remove(keys);
        options.close();
        options.selection.clear();
        const remaining = options.model().rowKeys;
        if (remaining.length) options.selection.setRows([remaining[Math.min(b.top, remaining.length - 1)]!]);
        return;
      }
      const read = (row: string, col: string) => cell(options.model().rowsByKey[row]!.data[col]);
      if (action === 'copy') {
        await writeClipboardText(renderCsvClipboard(keys.map((key) => cols.map((col) => read(key, col)))));
        return;
      }
      if (command.kind === 'fill') values = keys.map(() => cols.map(() => command.text));
      else if (action !== 'paste') {
        if (action === 'right' && keys.length === 1 && cols.length === 1 && b.left === 0) return;
        values = keys.map((key) =>
          cols.map((col) =>
            action === 'clear'
              ? ''
              : action === 'down'
                ? read(sources[0]!, col)
                : read(key, columns[keys.length === 1 && cols.length === 1 ? b.left - 1 : b.left]!),
          ),
        );
      }
      const written = owner.update(keys, cols, values);
      if (command.kind === 'fill') command.accept();
      options.close();
      if (action === 'paste') options.selection.set(written, cols);
    } catch (error) {
      if (current()) feedback.error(error, 'CSV 区域操作失败');
    } finally {
      busy.value = false;
    }
  }
  return { run, busy, cancel: () => revision++ };
}
