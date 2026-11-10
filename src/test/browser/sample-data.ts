import type { CsvTableKey } from '@/shared/types';
export const gameRoot = 'M:/sample-game',
  coreRoot = gameRoot + '/starsector-core';
export const workspaceRoots = ['Kratogen_TA', 'Polaris_Prime', 'ICE'].map((name) => gameRoot + '/mods/' + name);
export const gameFiles = new Map<string, string>(),
  gameImages = new Map<string, string>(),
  gameAudio = new Map<string, string>();
export const gameTablePaths: Record<CsvTableKey, string> = {
  ships: 'data/hulls/ship_data.csv',
  weapons: 'data/weapons/weapon_data.csv',
  wings: 'data/hulls/wing_data.csv',
  hullmods: 'data/hullmods/hull_mods.csv',
  shipSystems: 'data/shipsystems/ship_systems.csv',
  industries: 'data/campaign/industries.csv',
  skills: 'data/characters/skills/skill_data.csv',
  abilities: 'data/campaign/abilities.csv',
  commodities: 'data/campaign/commodities.csv',
  specialItems: 'data/campaign/special_items.csv',
  submarkets: 'data/campaign/submarkets.csv',
  marketConditions: 'data/campaign/market_conditions.csv',
  simOpponents: 'data/campaign/sim_opponents.csv',
  descriptions: 'data/strings/descriptions.csv',
};
