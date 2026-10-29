import { readGameCsv } from './game-format';
import type { CsvTableKey } from '@/shared/types';

const source = import.meta.glob<string>('./game/**/*.{csv,json,ship,skin,variant,wpn,proj,system,skill,faction,txt,java,svg,fnt}', {
  query: '?raw',
  import: 'default',
  eager: true,
});
export const gameRoot = 'M:/sample-game';
export const coreRoot = gameRoot + '/starsector-core';
export const workspaceRoots = ['Kratogen_TA', 'Polaris_Prime', 'ICE'].map((name) => gameRoot + '/mods/' + name);
export const gameFiles = new Map(Object.entries(source).map(([path, text]) => [gameRoot + path.slice('./game'.length), text]));
const images = import.meta.glob<string>('./game/**/*.{png,jpg,jpeg}', { query: '?url', import: 'default', eager: true });
export const gameImages = new Map(Object.entries(images).map(([path, url]) => [gameRoot + path.slice('./game'.length), url]));
const audio = import.meta.glob<string>('./game/**/*.ogg', { query: '?url', import: 'default', eager: true });
export const gameAudio = new Map(Object.entries(audio).map(([path, url]) => [gameRoot + path.slice('./game'.length), url]));
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
export { readGameCsv };
