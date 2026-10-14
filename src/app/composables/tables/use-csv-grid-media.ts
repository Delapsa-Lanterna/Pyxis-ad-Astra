import { inject, provide, type InjectionKey } from 'vue';
import type { ResourceRef } from '@/shared/types';
interface CsvGridMedia {
  url(resource: ResourceRef): string;
}
const key: InjectionKey<CsvGridMedia> = Symbol('csv-grid-media');
export function provideCsvGridMedia(media: CsvGridMedia) {
  provide(key, media);
}
export function useCsvGridMedia() {
  return inject(key)!;
}
