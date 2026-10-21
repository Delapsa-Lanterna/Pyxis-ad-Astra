import type { JsonEditorPageId, ProjectManifest, CsvTableKey, WorkspaceView } from '@/shared/types';
import { MODULE_LABELS } from '@/shared/lib/starsector';

export type ModNavigationTarget =
  | { type: 'mod-overview' }
  | { type: 'file-history' }
  | { type: 'json-editor'; page: JsonEditorPageId }
  | { type: 'table'; table: CsvTableKey }
  | { type: 'mod-files' };

export interface ModNavigationItem {
  id: string;
  label: string;
  count: number | null;
  target: ModNavigationTarget;
}

export interface ModNavigationSection {
  id: string;
  items: ModNavigationItem[];
}

const PRIMARY_TABLE_KEYS: CsvTableKey[] = ['ships', 'weapons', 'wings', 'hullmods', 'shipSystems'];
const SECONDARY_TABLE_KEYS: CsvTableKey[] = [
  'industries',
  'skills',
  'abilities',
  'commodities',
  'specialItems',
  'submarkets',
  'marketConditions',
];

export function buildModNavigationSections(manifest: ProjectManifest | null | undefined): ModNavigationSection[] {
  return [
    {
      id: 'workspace',
      items: [
        { id: 'mod-overview', label: 'Mod 概览', count: null, target: { type: 'mod-overview' } },
        { id: 'mod-files', label: 'Mod 文件', count: null, target: { type: 'mod-files' } },
        { id: 'file-history', label: '文件历史', count: null, target: { type: 'file-history' } },
      ],
    },
    {
      id: 'mod-info',
      items: [jsonItem('mod-info', 'Mod 信息')],
    },
    {
      id: 'combat',
      items: [
        ...PRIMARY_TABLE_KEYS.map((key) => tableItem(key, manifest)),
        jsonItem('skins', '舰船皮肤', manifest?.entitySummaries.skins ?? 0),
        jsonItem('variants', '装配', manifest?.entitySummaries.variants ?? 0),
        tableItem('simOpponents', manifest),
        tableItem('descriptions', manifest),
      ],
    },
    {
      id: 'campaign',
      items: [
        jsonItem('factions', '势力', manifest?.entitySummaries.factions ?? 0),
        ...SECONDARY_TABLE_KEYS.map((key) => tableItem(key, manifest)),
        jsonItem('mission', '战役', manifest?.entitySummaries.missions ?? 0),
      ],
    },
  ];
}

export function isModNavigationItemActive(
  item: ModNavigationItem,
  currentView: WorkspaceView,
  jsonPage: JsonEditorPageId,
  currentTable: CsvTableKey,
): boolean {
  if (item.target.type === 'mod-files') return currentView === 'mod-files';
  if (item.target.type === 'mod-overview') return currentView === 'mod-overview';
  if (item.target.type === 'file-history') return currentView === 'file-history';
  if (item.target.type === 'json-editor') return currentView === 'json-editor' && jsonPage === item.target.page;
  return currentView === 'table' && currentTable === item.target.table;
}

function jsonItem(page: JsonEditorPageId, label: string, count: number | null = null): ModNavigationItem {
  return {
    id: `json:${page}`,
    label,
    count,
    target: { type: 'json-editor', page },
  };
}

function tableItem(table: CsvTableKey, manifest: ProjectManifest | null | undefined): ModNavigationItem {
  return {
    id: `table:${table}`,
    label: MODULE_LABELS[table],
    count: manifest?.tableEntitySummaries[table] ?? 0,
    target: { type: 'table', table },
  };
}
