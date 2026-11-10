import { expect, it } from 'vitest';
import { scenarios, workspaceEntries } from './scenarios';
import { performanceScenarios, createScenario } from '../testbed/scenarios';
import { cases } from '../testbed/cases/registry';
import { galleryFields, fieldValues } from './fields';
import { FIELD_TYPES } from '@/domain/schema/schema.types';

it('registers functional destinations, real window shortcuts and independently runnable performance samples', () => {
  expect(scenarios.map(({ id }) => id)).toEqual(['workspace', 'csv', 'immersive', 'fields', 'pickers', 'resources', 'feedback']);
  expect(workspaceEntries).toHaveLength(31);
  expect(new Set(workspaceEntries.map(({ href }) => href)).size).toBe(31);
  expect(workspaceEntries.find(({ id }) => id === 'code-window')).toMatchObject({ href: '/?sampleWindow=code-window' });
  expect(performanceScenarios.map(({ id }) => id)).toEqual(['csv', 'weapons', 'wings', 'hullmods', 'code-editor', 'text-editor']);
  expect(performanceScenarios.flatMap(({ counts }) => counts)).toHaveLength(16);
  expect(Object.keys(cases)).toEqual(performanceScenarios.map((scene) => scene.id));
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
