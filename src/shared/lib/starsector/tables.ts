import type { CsvTableKey } from '@/shared/types';

export const MODULE_LABELS: Record<CsvTableKey, string> = {
  ships: '舰船',
  weapons: '武器',
  wings: '战机联队',
  hullmods: '船体插件',
  shipSystems: '战术系统',
  industries: '工业',
  skills: '技能',
  abilities: '舰队能力',
  commodities: '贸易商品',
  specialItems: '特殊物品',
  submarkets: '市场类型',
  marketConditions: '市场条件',
  corvusSpawnpoints: '固定星域出生点',
  simOpponents: '模拟对手',
  descriptions: '描述文本',
};

export function csvIdentityColumn(table: CsvTableKey) {
  switch (table) {
    case 'simOpponents':
      return 'variant id';
    case 'corvusSpawnpoints':
      return 'faction';
    default:
      return 'id';
  }
}
