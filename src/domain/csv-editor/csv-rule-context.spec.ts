import { describe, expect, it } from 'vitest';
import { hasCsvValidationInvalidation as affects } from './csv-rule-context';
import { hasSourceInvalidation } from '@/services/source-catalog.service';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import type { CsvValidationRequest, EntityKind } from '@/shared/types';

function request(kind: EntityKind = 'ship'): CsvValidationRequest {
  return { entities: [{ kind, id: 'sample' }], sources: [], files: [], classes: [], stationData: [] };
}
const hasCsvValidationInvalidation = (scope: Parameters<typeof affects>[0], input: CsvValidationRequest) =>
  affects(scope, input, (source) => hasSourceInvalidation(scope, source));
describe('CSV validation dependency scope', () => {
  it.each(['mod_info.json', 'data/hulls/ship_data.csv', 'graphics/unrelated.png'])(
    'retains spec validation when %s changes independently',
    (relPath) => {
      const scope = savedWriteFixture().invalidation;
      scope.entities = relPath.endsWith('.csv') ? [{ kind: 'ship', id: null }] : [];
      scope.resources = [{ source: 'mod', relPath }];
      expect(hasCsvValidationInvalidation(scope, request())).toBe(false);
    },
  );
  it.each([
    ['ship', 'ship', 'data/hulls/sample.ship'],
    ['weapon', 'projectile', 'data/weapons/proj/sample.proj'],
    ['variant', 'skin', 'data/hulls/skins/sample.skin'],
  ] as const)('refreshes %s validation for its %s dependency', (kind, dependency, relPath) => {
    const scope = savedWriteFixture().invalidation;
    scope.entities = [{ kind: dependency, id: 'sample' }];
    scope.resources = [{ source: 'mod', relPath }];
    expect(hasCsvValidationInvalidation(scope, request(kind))).toBe(true);
  });
  it('refreshes matching source catalogs, image paths and script archives', () => {
    const scope = savedWriteFixture().invalidation;
    const input = request();
    input.sources = ['csv:shipSystems.id'];
    scope.queryScopes = [{ kind: 'csv-source-options', table: 'shipSystems', source: null, entity: null, resource: null }];
    expect(hasCsvValidationInvalidation(scope, input)).toBe(true);
    scope.queryScopes = [];
    input.files = ['graphics/sample.png'];
    scope.resources = [{ source: 'mod', relPath: 'graphics' }];
    expect(hasCsvValidationInvalidation(scope, input)).toBe(true);
    input.files = [];
    input.classes = ['sample.Script'];
    scope.resources = [{ source: 'mod', relPath: 'jars/sample.jar' }];
    expect(hasCsvValidationInvalidation(scope, input)).toBe(true);
    scope.resources = [{ source: 'mod', relPath: 'mod_info.json' }];
    expect(hasCsvValidationInvalidation(scope, input)).toBe(true);
  });
});
