import { arr } from '@/shared/lib/starsector';
import type { RowData } from '@/shared/types';
import type { useEditorDocument } from './use-editor-document';

export function useEditorFields(document: ReturnType<typeof useEditorDocument>) {
  const set = (key: string, value: RowData[string]) =>
    document.change((draft) => {
      draft[key] = value;
    });
  const array = (key: string, index: number, value: number | null) =>
    document.change((draft) => {
      const values = arr(draft[key], [0, 0]);
      values[index] = value || 0;
      draft[key] = values;
    });
  const color = (key: string, fallback = [255, 255, 255, 255]) =>
    document.field(
      key,
      (value) => arr(value, fallback),
      (value) => value,
    );
  const object = (key: string) =>
    document.field(
      key,
      (value) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as RowData) : {}),
      (value) => value,
    );
  return { set, array, color, object };
}
