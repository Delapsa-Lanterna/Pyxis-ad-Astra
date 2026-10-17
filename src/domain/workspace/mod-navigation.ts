import type { ConfigView, ProjectManifest, CsvTableKey, WorkspaceView } from '@/shared/types';
import { MODULE_LABELS } from '@/shared/lib/starsector';

export type ModNavigationTarget = { type: 'config'; view: ConfigView } | { type: 'table'; table: CsvTableKey } | { type: 'mod-files' };

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
        configItem('mod-overview', 'Mod 概览'),
        { id: 'mod-files', label: 'Mod 文件', count: null, target: { type: 'mod-files' } },
        configItem('file-history', '文件历史'),
      ],
    },
    {
      id: 'mod-info',
      items: [configItem('mod-info', 'Mod 信息')],
    },
    {
      id: 'combat',
      items: [
        ...PRIMARY_TABLE_KEYS.map((key) => tableItem(key, manifest)),
        configItem('skins', '舰船皮肤', manifest?.entitySummaries.skins ?? 0),
        configItem('variants', '装配', manifest?.entitySummaries.variants ?? 0),
        tableItem('simOpponents', manifest),
        tableItem('descriptions', manifest),
      ],
    },
    {
      id: 'campaign',
      items: [
        configItem('factions', '势力', manifest?.entitySummaries.factions ?? 0),
        ...SECONDARY_TABLE_KEYS.map((key) => tableItem(key, manifest)),
        configItem('mission', '战役', manifest?.entitySummaries.missions ?? 0),
      ],
    },
  ];
}

export function isModNavigationItemActive(
  item: ModNavigationItem,
  currentView: WorkspaceView,
  configView: ConfigView,
  currentTable: CsvTableKey,
): boolean {
  if (item.target.type === 'mod-files') return currentView === 'mod-files';
  if (item.target.type === 'config') return currentView === 'config' && configView === item.target.view;
  return currentView === 'table' && currentTable === item.target.table;
}

function configItem(view: ConfigView, label: string, count: number | null = null): ModNavigationItem {
  return {
    id: `config:${view}`,
    label,
    count,
    target: { type: 'config', view },
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
