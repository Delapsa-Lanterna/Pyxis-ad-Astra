import type { CsvTableKey } from '@/shared/types';
import type { CsvColumnSchema } from '@/domain/schema/schema.types';
import { parseCsvColumnSchemas } from '@/domain/schema/schema-asset-parser';
import abilitiesColumnsRaw from '../../../schemas/csv/abilities.schema.json';
import commoditiesColumnsRaw from '../../../schemas/csv/commodities.schema.json';
import descriptionsColumnsRaw from '../../../schemas/csv/descriptions.schema.json';
import hullmodsColumnsRaw from '../../../schemas/csv/hullmods.schema.json';
import industriesColumnsRaw from '../../../schemas/csv/industries.schema.json';
import marketConditionsColumnsRaw from '../../../schemas/csv/marketConditions.schema.json';
import shipSystemsColumnsRaw from '../../../schemas/csv/shipSystems.schema.json';
import shipsColumnsRaw from '../../../schemas/csv/ships.schema.json';
import simOpponentsColumnsRaw from '../../../schemas/csv/simOpponents.schema.json';
import skillsColumnsRaw from '../../../schemas/csv/skills.schema.json';
import specialItemsColumnsRaw from '../../../schemas/csv/specialItems.schema.json';
import submarketsColumnsRaw from '../../../schemas/csv/submarkets.schema.json';
import weaponsColumnsRaw from '../../../schemas/csv/weapons.schema.json';
import wingsColumnsRaw from '../../../schemas/csv/wings.schema.json';

const CSV_COLUMN_SCHEMAS: Record<CsvTableKey, CsvColumnSchema[]> = {
  abilities: parseCsvColumnSchemas('abilities', abilitiesColumnsRaw),
  commodities: parseCsvColumnSchemas('commodities', commoditiesColumnsRaw),
  descriptions: parseCsvColumnSchemas('descriptions', descriptionsColumnsRaw),
  hullmods: parseCsvColumnSchemas('hullmods', hullmodsColumnsRaw),
  industries: parseCsvColumnSchemas('industries', industriesColumnsRaw),
  marketConditions: parseCsvColumnSchemas('marketConditions', marketConditionsColumnsRaw),
  shipSystems: parseCsvColumnSchemas('shipSystems', shipSystemsColumnsRaw),
  ships: parseCsvColumnSchemas('ships', shipsColumnsRaw),
  simOpponents: parseCsvColumnSchemas('simOpponents', simOpponentsColumnsRaw),
  skills: parseCsvColumnSchemas('skills', skillsColumnsRaw),
  specialItems: parseCsvColumnSchemas('specialItems', specialItemsColumnsRaw),
  submarkets: parseCsvColumnSchemas('submarkets', submarketsColumnsRaw),
  weapons: parseCsvColumnSchemas('weapons', weaponsColumnsRaw),
  wings: parseCsvColumnSchemas('wings', wingsColumnsRaw),
};

export function getCsvColumnSchemas(table: CsvTableKey): CsvColumnSchema[] {
  return CSV_COLUMN_SCHEMAS[table] ?? [];
}
