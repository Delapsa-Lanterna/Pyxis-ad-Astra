import { describe, expect, it } from 'vitest';
import { BROWSER_VIEWS, readBrowserLocation, locationSearch, locationHref } from './location';
import { SPEC_EDITOR_KINDS, JOINT_EDIT_KINDS, TABLE_KEYS } from '@/shared/types';
import { JSON_DOCUMENT_DEFINITIONS } from '@/domain/json-editor/json-document-definitions';
import { scenarios } from './preview/scenarios';
import { performanceScenarios } from './testbed/scenarios';
import type { BrowserLocation } from './location';

describe('browser location protocol', () => {
  const destinations: BrowserLocation[] = [
    ...(['workspace', 'settings', 'about'] as const).map((view) => ({ view })),
    ...(['mod-overview', 'file-history', 'files', 'code'] as const).map((view) => ({ view, mod: 'fixture_mod' })),
    ...TABLE_KEYS.map((table): BrowserLocation => ({ view: 'table', mod: 'fixture_mod', table, row: 3, column: 'id' })),
    ...Object.keys(JSON_DOCUMENT_DEFINITIONS).map((page): BrowserLocation => ({
      view: 'json',
      mod: 'fixture_mod',
      page: page as BrowserLocation['page'],
      id: 'fixture_item',
    })),
    ...SPEC_EDITOR_KINDS.map((kind): BrowserLocation => ({ view: 'spec', mod: 'fixture_mod', kind, id: 'fixture_entity' })),
    ...JOINT_EDIT_KINDS.map((kind): BrowserLocation => ({ view: 'immersive', mod: 'fixture_mod', kind, id: 'fixture_entity' })),
    { view: 'text', mod: 'fixture_mod', path: 'data/中文 file.json', line: 3, column: '4' },
    { view: 'code', mod: 'fixture_sample', sampleWindow: 'code-window', path: 'src/File.java' },
    { view: 'preview', mod: 'fixture_mod', id: 'fixture_weapon' },
    ...scenarios.flatMap((scene) => scene.samples.map((sample): BrowserLocation => ({ view: 'scene', scene: scene.id, sample }))),
    ...performanceScenarios.map((scene): BrowserLocation => ({ view: 'testbed', scene: scene.id, count: 30, warmup: 0, rounds: 2 })),
  ];
  it.each(destinations)('round trips $view $kind $table $page $scene $sample', (location) => {
    expect(readBrowserLocation(locationSearch(location))).toEqual(location);
    expect(locationHref(location, '/site/')).toBe('/site/' + (locationSearch(location) ? '?' + locationSearch(location) : ''));
  });
  it('covers every registered browser view and preserves sample appearance and performance options', () => {
    expect(new Set(destinations.map((entry) => entry.view))).toEqual(new Set(BROWSER_VIEWS));
    const location: BrowserLocation = {
      view: 'testbed',
      scene: 'weapons',
      workload: 'resources',
      resourceSize: 128,
      count: 32,
      rounds: 3,
      warmup: 0,
      fileBytes: 102400,
      textShape: 'long-line',
      monitor: true,
      theme: 'dark',
      accent: 'green',
      source: 'all',
    };
    expect(readBrowserLocation(locationSearch(location))).toEqual(location);
  });
  it.each([
    'view=unknown',
    'sampleWindow=unknown',
    'view=table&mod=fixture_mod&table=unknown',
    'view=json&mod=fixture_mod&page=unknown',
    'view=immersive&mod=fixture_mod&kind=projectile&id=x',
    'view=spec&kind=ship&id=x',
    'view=text&mod=fixture_mod&path=../outside',
    'view=text&mod=fixture_mod&path=C:/outside',
    'view=text&mod=fixture_mod&path=/outside',
    'view=text&mod=fixture_mod&path=data/x&line=0',
    'view=text&mod=fixture_mod&path=data/x&column=none',
    'view=table&mod=fixture_mod&table=ships&row=1.5',
    'view=scene&scene=immersive&sample=csv',
    'view=testbed&scene=unknown',
    'view=testbed&scene=ship&workload=resources',
    'view=testbed&rounds=0',
    'view=about&view=settings',
  ])('rejects an invalid external location: %s', (search) => {
    expect(() => readBrowserLocation(search)).toThrow();
  });
});
