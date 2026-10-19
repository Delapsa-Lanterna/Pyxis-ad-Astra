import { QUERY_CACHE_KEYS, type CacheLimits } from '@/shared/types';

export function readCacheLimits(value: CacheLimits): CacheLimits {
  const entry = (number: number, maximum: number, key: string) => {
    if (!Number.isInteger(number) || number < 0 || number > maximum) throw new Error(`Invalid cache limit ${key}: ${number}`);
  };
  for (const key of ['mediaData', 'decodedImages', 'thumbnails', 'backendMedia'] as const) {
    entry(value[key].entries, 65536, key + '.entries');
    entry(value[key].MiB, 4096, key + '.MiB');
  }
  const queries = QUERY_CACHE_KEYS;
  if (Object.keys(value.queries).length !== queries.length) throw new Error('Invalid query cache keys');
  for (const key of queries) entry(value.queries[key], 65536, 'queries.' + key);
  entry(value.fonts.glyphEntriesPerPage, 65536, 'fonts.glyphEntriesPerPage');
  return value;
}
