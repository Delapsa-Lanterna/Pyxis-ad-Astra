import { computed, inject, onScopeDispose, provide, shallowReactive, watch, type InjectionKey } from 'vue';
import type { CsvRowRecord, CsvTableTarget, ResourceRef } from '@/shared/types';
import type { CsvGridColumn } from '@/domain/csv-editor/csv-grid-model';
import { queryCsvRowResources } from '@/services/csv-table.service';
import { subscribeResourceInvalidations } from '@/services/resource-media.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
interface CsvGridMedia {
  url(resource: ResourceRef): string;
  image(row: CsvRowRecord, column: CsvGridColumn): ResourceRef | null | undefined;
}
const key: InjectionKey<CsvGridMedia> = Symbol('csv-grid-media');
export function provideCsvGridMedia(media: CsvGridMedia) {
  provide(key, media);
}
export function useCsvGridMedia() {
  return inject(key)!;
}

export function useCsvGridImages(target: CsvTableTarget, rows: () => CsvRowRecord[], column: () => CsvGridColumn | undefined) {
  const resources = shallowReactive(new Map<string, ResourceRef | null>());
  const reads = useQueryReadOwner(),
    feedback = useAppFeedback();
  const identity = (row: CsvRowRecord, column: CsvGridColumn) =>
    JSON.stringify([row.rowKey, row.isComment, row.data.id, row.data[column.key]]);
  const request = computed(() => {
    const image = column();
    return image
      ? rows().map((row) => ({
          rowKey: row.rowKey,
          isComment: row.isComment,
          data: { id: row.data.id!, [image.key]: row.data[image.key]! },
        }))
      : [];
  });
  watch(
    () => JSON.stringify(request.value),
    () => {
      reads.revoke('consumer');
      const image = column(),
        requested = request.value;
      const keys = new Set(requested.map((row) => identity(row, image!)));
      for (const key of resources.keys()) if (!keys.has(key)) resources.delete(key);
      const missing = requested.filter((row) => !resources.has(identity(row, image!)));
      if (!missing.length) return;
      void reads.consume(
        'images',
        { ...target, rows: missing },
        (signal) =>
          queryCsvRowResources(
            target.sessionId,
            target.table,
            missing.map((row) => row.rowKey),
            missing,
            signal,
          ),
        {
          ready: (result) => {
            for (const row of missing) resources.set(identity(row, image!), result[row.rowKey]!);
          },
          error: (error) => feedback.error(error, '加载 CSV 图片引用失败'),
        },
      );
    },
    { immediate: true },
  );
  onScopeDispose(
    subscribeResourceInvalidations((event) => {
      if (event.sessionId === target.sessionId && event.scope === 'session') {
        reads.revoke('session');
        resources.clear();
      }
    }),
  );
  return (row: CsvRowRecord, column: CsvGridColumn) => resources.get(identity(row, column));
}
