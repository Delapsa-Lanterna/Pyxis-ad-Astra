import { expect, it } from 'vitest';
import { scenarios, workspaceEntries, performanceScenarios, createScenario } from './registry';
import { galleryFields, fieldValues } from './fields';
import { FIELD_TYPES } from '@/domain/schema/schema.types';

it('registers functional destinations, real window shortcuts and independently runnable performance samples', () => {
  expect(scenarios.map(({ id }) => id)).toEqual(['workspace', 'csv', 'immersive', 'fields', 'pickers', 'resources', 'feedback']);
  expect(workspaceEntries).toHaveLength(30);
  expect(new Set(workspaceEntries.map(({ href }) => href)).size).toBe(30);
  expect(performanceScenarios.map(({ id }) => id)).toEqual(['csv', 'weapons', 'wings', 'hullmods']);
  expect(performanceScenarios.flatMap(({ counts }) => counts)).toHaveLength(12);
  expect(galleryFields.slice(0, FIELD_TYPES.length).map(({ type }) => type)).toEqual(FIELD_TYPES);
  const values = fieldValues();
  expect(values.modulesObject).toEqual({});
  expect(values.modulesArray).toEqual([]);
});

it('creates a shared picker sample with the selected source scope and appearance', () => {
  const model = createScenario({
    scene: 'weapons',
    count: 30,
    source: 'core',
    resourceSize: 0,
    monitor: false,
    theme: 'dark',
    accent: 'orange',
  });
  expect(model.catalog('weapons').every(({ source }) => source.source === 'core')).toBe(true);
  expect(model.settings).toMatchObject({ theme: 'dark', accent: 'orange' });
});
