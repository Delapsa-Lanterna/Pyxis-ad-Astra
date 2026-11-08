import type { RowData } from '@/shared/types';
import { isRowData } from '@/shared/lib/row-data';
import { specSchema, specSections } from '@/domain/spec-editor/spec-schemas';
import { specFieldsIssues } from '@/domain/spec-editor/spec-validation';
import { schemaDocumentIssues, schemaFieldIssues } from '@/domain/schema/schema-validation';
const schema = specSchema('spec-projectile');
export const EXPLOSION_FIELDS = schema.definitions!.explosion!.nested!;
export const MISSILE_ENGINE_FIELDS = schema.definitions!.engine!.nested!;
export const PROJECTILE_CUSTOM_ENGINE_FIELDS = schema.definitions!.customEngine!.nested!;
export function projectileSections(missile: boolean) {
  return specSections('spec-projectile', { specClass: missile ? 'missile' : 'projectile' });
}
export function projectileSpecIssues(projectile: RowData, partial = false) {
  const engines = Array.isArray(projectile.engineSlots) ? projectile.engineSlots : [];
  return [
    ...schemaDocumentIssues(schema, projectile, partial),
    ...(isRowData(projectile.explosionSpec)
      ? specFieldsIssues(EXPLOSION_FIELDS, projectile.explosionSpec, 'explosionSpec.', partial)
      : schemaFieldIssues(
          { ...schema.definitions!.explosion!, nested: undefined },
          projectile.explosionSpec,
          'explosionSpec',
          partial,
          projectile,
        )),
    ...schemaFieldIssues(schema.definitions!.engineSlots!, projectile.engineSlots, 'engineSlots', partial, projectile),
    ...engines.flatMap((engine, index) =>
      isRowData(engine)
        ? [
            ...specFieldsIssues(MISSILE_ENGINE_FIELDS, engine, `engineSlots[${index}].`, partial),
            ...(engine.style === 'CUSTOM'
              ? specFieldsIssues(PROJECTILE_CUSTOM_ENGINE_FIELDS, engine, `engineSlots[${index}].`, partial)
              : []),
          ]
        : [],
    ),
  ];
}
