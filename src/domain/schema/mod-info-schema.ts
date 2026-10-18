import { parseFileSchema } from '@/domain/schema/schema-asset-parser';
import modInfoSchemaRaw from '../../../schemas/mod-info.schema.json';

export const MOD_INFO_SCHEMA = parseFileSchema('mod-info', modInfoSchemaRaw);
