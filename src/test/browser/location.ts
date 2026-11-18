import { APP_THEMES, ACCENT_PRESET_VALUES, JOINT_EDIT_KINDS, SPEC_EDITOR_KINDS, TABLE_KEYS } from '@/shared/types';
import type { AccentPreset, AppTheme, CsvTableKey, JsonEditorPageId, JointEditKind, SpecEditorKind } from '@/shared/types';
import { JSON_DOCUMENT_DEFINITIONS } from '@/domain/json-editor/json-document-definitions';
import { scenarios } from './preview/scenarios';
import { performanceScenarios } from '../../../scripts/browser/testbed/scenarios.mjs';
import type { ScenarioOptions, RunOptions } from './contracts';

export const BROWSER_VIEWS = [
  'workspace',
  'settings',
  'about',
  'mod-overview',
  'file-history',
  'files',
  'table',
  'json',
  'spec',
  'immersive',
  'text',
  'code',
  'preview',
  'scene',
  'testbed',
] as const;
export type BrowserView = (typeof BROWSER_VIEWS)[number];
export interface BrowserLocation {
  view: BrowserView;
  sampleWindow?: 'code-window' | 'spec-window' | 'text-window' | 'immersive-window' | 'preview-window';
  mod?: string;
  kind?: JointEditKind | SpecEditorKind;
  id?: string;
  table?: CsvTableKey;
  page?: JsonEditorPageId;
  path?: string;
  row?: number;
  line?: number;
  column?: string;
  scene?: string;
  sample?: ScenarioOptions['scene'];
  source?: ScenarioOptions['source'];
  theme?: AppTheme;
  accent?: AccentPreset;
  count?: number;
  resourceSize?: number;
  warmup?: number;
  rounds?: number;
  fileBytes?: number;
  textShape?: RunOptions['textShape'];
  workload?: RunOptions['workload'];
  monitor?: boolean;
}
const locationKeys = [
  'view',
  'sampleWindow',
  'mod',
  'kind',
  'id',
  'table',
  'page',
  'path',
  'row',
  'line',
  'column',
  'scene',
  'sample',
  'source',
  'theme',
  'accent',
  'count',
  'resourceSize',
  'warmup',
  'rounds',
  'fileBytes',
  'textShape',
  'workload',
  'monitor',
] as const;
function choice<T extends string>(value: string, choices: readonly T[], field: string): T {
  if (!choices.includes(value as T)) throw Error('链接参数 ' + field + ' 无效：' + value);
  return value as T;
}
function required(query: URLSearchParams, field: string) {
  const value = query.get(field);
  if (!value) throw Error('链接缺少参数 ' + field);
  return value;
}
export function readBrowserLocation(search: string, defaultView: BrowserView = 'workspace'): BrowserLocation {
  const query = new URLSearchParams(search);
  for (const key of locationKeys) if (query.getAll(key).length > 1) throw Error('链接参数 ' + key + ' 重复');
  const view = choice(query.get('view') ?? defaultView, BROWSER_VIEWS, 'view');
  const location: BrowserLocation = { view };
  if (query.has('sampleWindow'))
    location.sampleWindow = choice(
      required(query, 'sampleWindow'),
      ['code-window', 'spec-window', 'text-window', 'immersive-window', 'preview-window'] as const,
      'sampleWindow',
    );
  for (const key of ['mod', 'id', 'column'] as const) {
    const value = query.get(key);
    if (value !== null && value !== '') location[key] = value;
  }
  if (!['workspace', 'settings', 'about', 'scene', 'testbed'].includes(view)) location.mod = required(query, 'mod');
  if (view === 'table') location.table = choice(required(query, 'table'), TABLE_KEYS, 'table');
  if (view === 'json')
    location.page = choice(required(query, 'page'), Object.keys(JSON_DOCUMENT_DEFINITIONS) as JsonEditorPageId[], 'page');
  if (view === 'spec') location.kind = choice(required(query, 'kind'), SPEC_EDITOR_KINDS, 'kind');
  if (view === 'immersive') location.kind = choice(required(query, 'kind'), JOINT_EDIT_KINDS, 'kind');
  if (['spec', 'immersive', 'preview'].includes(view)) location.id = required(query, 'id');
  const path = query.get('path')?.replaceAll('\\', '/');
  if (path) {
    if (
      /^(?:\/|[a-z]:)/i.test(path) ||
      path.split('/').includes('..') ||
      Array.from(path).some((character) => character.charCodeAt(0) < 32)
    )
      throw Error('链接中的文件路径必须位于所选项目内');
    location.path = path
      .split('/')
      .filter((part) => part !== '.')
      .join('/');
  }
  if (view === 'text' && !location.path) throw Error('链接缺少参数 path');
  for (const key of ['row', 'line', 'count', 'resourceSize', 'warmup', 'rounds', 'fileBytes'] as const) {
    const value = query.get(key);
    if (value === null) continue;
    const number = Number(value),
      minimum = ['resourceSize', 'warmup'].includes(key) ? 0 : 1;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < minimum) throw Error('链接参数 ' + key + ' 无效：' + value);
    location[key] = number;
  }
  if (['text', 'code'].includes(view) && location.column && !/^[1-9]\d*$/.test(location.column))
    throw Error('链接参数 column 必须是正整数');
  if (query.has('theme')) location.theme = choice(required(query, 'theme'), APP_THEMES, 'theme');
  if (query.has('accent')) location.accent = choice(required(query, 'accent'), ACCENT_PRESET_VALUES, 'accent');
  if (query.has('source')) location.source = choice(required(query, 'source'), ['mod', 'core', 'all'] as const, 'source');
  if (view === 'scene') {
    const scene = required(query, 'scene'),
      definition = scenarios.find((entry) => entry.id === scene && entry.samples.length);
    if (!definition) throw Error('链接中的场景无效：' + scene);
    location.scene = scene;
    location.sample = choice(query.get('sample') ?? definition.samples[0]!, definition.samples, 'sample');
  }
  if (view === 'testbed') {
    location.scene = choice(
      query.get('scene') ?? 'csv',
      performanceScenarios.map((entry) => entry.id),
      'scene',
    );
    if (query.has('workload'))
      location.workload = choice(required(query, 'workload'), ['benchmark', 'stress', 'resources'] as const, 'workload');
    if (query.has('textShape')) location.textShape = choice(required(query, 'textShape'), ['multiline', 'long-line'] as const, 'textShape');
    if (query.has('monitor')) location.monitor = choice(required(query, 'monitor'), ['0', '1'], 'monitor') === '1';
    if (location.workload === 'resources' && location.scene !== 'weapons') throw Error('资源压力场景必须选择 weapons');
  }
  return location;
}
export function locationSearch(location: BrowserLocation) {
  const query = new URLSearchParams();
  for (const key of locationKeys) {
    const value = location[key];
    if (value !== undefined && value !== '' && !(key === 'view' && value === 'workspace'))
      query.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  return query.toString();
}
export function locationHref(location: BrowserLocation, base = import.meta.env.BASE_URL) {
  const search = locationSearch(location);
  return base + (search ? '?' + search : '');
}
export function browserBase() {
  return new URL('.', window.location.href).pathname;
}
