export const QUERY_CACHE_KEYS = [
  'joint-edit-catalog',
  'joint-edit-candidate',
  'csv-table-window',
  'csv-source-options',
  'csv-row-preview',
  'hull-references',
  'entity-detail',
  'entity-list',
] as const;
export type QueryCacheKey = (typeof QUERY_CACHE_KEYS)[number];
export interface FontCacheLimits {
  glyphEntriesPerPage: number;
}
export interface CacheSize {
  entries: number;
  MiB: number;
}
export interface CacheLimits {
  mediaData: CacheSize;
  decodedImages: CacheSize;
  thumbnails: CacheSize;
  backendMedia: CacheSize;
  queries: Record<QueryCacheKey, number>;
  fonts: FontCacheLimits;
}
