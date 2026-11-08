import type { JsonValue, RowData } from '@/shared/types';
import { parseCsvFieldSource, isEntityFieldSource, isConfigFieldSource } from '@/domain/schema/schema-source-definitions';
import type { FieldSchema, FileSchema } from '@/domain/schema/schema.types';

export function validateSchemaSources(schema: FileSchema): void {
  const fields = schema.root ? [schema.root] : (schema.sections ?? []).flatMap((section) => section.fields);
  validateSchemaFieldSources([...fields, ...Object.values(schema.definitions ?? {})], 'file');
}

export function aggregateSchemaSources(sources: Record<string, unknown>): RowData {
  const result: RowData = {};
  for (const [sourceId, value] of Object.entries(sources)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[sourceId] = value as RowData;
    } else {
      result[sourceId] = { content: scalarToJsonValue(value) };
    }
  }
  return result;
}

export function splitSchemaSources(model: RowData, schema: FileSchema): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const source of schema.sources ?? []) {
    const value = model[source.id];
    if (source.type === 'text-file') {
      result[source.id] =
        value && typeof value === 'object' && !Array.isArray(value) ? ((value as Record<string, unknown>).content ?? '') : value;
    } else {
      result[source.id] = value;
    }
  }
  return result;
}

function scalarToJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

function validateSchemaFieldSources(fields: FieldSchema[], parentPath: string): void {
  for (const field of fields) {
    const path = `${parentPath}.${field.key}`;
    if (field.source?.startsWith('csv:') && !parseCsvFieldSource(field.source) && !isEntityFieldSource(field.source)) {
      throw new Error(`Invalid CSV source "${field.source}" at schema field "${path}"`);
    }
    if (field.source?.startsWith('config:') && !isConfigFieldSource(field.source)) {
      throw new Error(`Invalid config source "${field.source}" at schema field "${path}"`);
    }
    if (field.nested) validateSchemaFieldSources(field.nested, path);
    if (field.item) validateSchemaFieldSources([field.item], `${path}[]`);
    if (field.valueSchema) validateSchemaFieldSources([field.valueSchema], `${path}{}`);
    if (field.keySchema) validateSchemaFieldSources([field.keySchema], `${path}{key}`);
    if (field.variants) validateSchemaFieldSources(field.variants, path);
  }
}
