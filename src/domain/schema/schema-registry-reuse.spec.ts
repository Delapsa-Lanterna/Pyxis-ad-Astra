import { afterEach, expect, it, vi } from 'vitest';
import { TABLE_KEYS } from '@/shared/types';

vi.mock('./schema-asset-parser', () => ({
  parseFileSchema: vi.fn((_id: string, asset: unknown) => asset),
  parseCsvColumnSchemas: vi.fn((_id: string, asset: { columns: unknown[] }) => asset.columns),
}));
afterEach(() => vi.clearAllMocks());

it('parses each bundled asset once across concurrent imports and repeated registry reads', async () => {
  vi.resetModules();
  vi.clearAllMocks();
  const [config, sameConfig, csv, sameCsv] = await Promise.all([
    import('./config-schema-registry'),
    import('./config-schema-registry'),
    import('./csv-schema-registry'),
    import('./csv-schema-registry'),
  ]);
  const ids = Object.keys(import.meta.glob('../../../schemas/*.schema.json')).map((path) =>
    path.slice(path.lastIndexOf('/') + 1, -'.schema.json'.length),
  );
  const parser = await import('./schema-asset-parser');
  const parsedFiles = vi.mocked(parser.parseFileSchema),
    parsedColumns = vi.mocked(parser.parseCsvColumnSchemas);
  expect(config).toBe(sameConfig);
  expect(csv).toBe(sameCsv);
  for (const id of ids) expect(config.getSchema(id)).toBe(config.getSchema(id));
  for (const table of TABLE_KEYS) expect(csv.getCsvColumnSchemas(table)).toBe(csv.getCsvColumnSchemas(table));
  expect(parsedFiles.mock.calls.map(([id]) => id).sort()).toEqual([...ids].sort());
  expect(parsedColumns.mock.calls.map(([id]) => id).sort()).toEqual([...TABLE_KEYS].sort());
  expect(parsedFiles).toHaveBeenCalledTimes(ids.length);
  expect(parsedColumns).toHaveBeenCalledTimes(TABLE_KEYS.length);
});
