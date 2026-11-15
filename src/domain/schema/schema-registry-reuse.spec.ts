import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TABLE_KEYS } from '@/shared/types';

beforeEach(async () => {
  vi.resetModules();
  const parser = await import('./schema-asset-parser');
  vi.spyOn(parser, 'parseFileSchema');
  vi.spyOn(parser, 'parseCsvColumnSchemas');
  vi.spyOn(parser, 'parseValueCatalog');
});
afterEach(() => vi.restoreAllMocks());

it('parses each bundled asset once across concurrent imports and repeated registry reads', async () => {
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
  const catalogIds = Object.keys(import.meta.glob('../../../schemas/value-catalogs/*.json')).map((path) =>
    path.slice(path.lastIndexOf('/') + 1, -'.json'.length),
  );
  expect(
    vi
      .mocked(parser.parseValueCatalog)
      .mock.calls.map(([id]) => id)
      .sort(),
  ).toEqual(catalogIds.sort());
  expect(parser.parseValueCatalog).toHaveBeenCalledTimes(catalogIds.length);
});
