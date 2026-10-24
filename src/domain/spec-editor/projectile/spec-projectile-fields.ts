import type { RowData } from '@/shared/types';
import { isRowData } from '@/shared/lib/row-data';
import { specSchema, specSections } from '@/domain/spec-editor/spec-schemas';
import { specFieldsIssues, specFieldIssues } from '@/domain/spec-editor/spec-validation';
const schema = specSchema('spec-projectile');
export const EXPLOSION_FIELDS = schema.definitions!.explosion!.nested!;
export const MISSILE_ENGINE_FIELDS = schema.definitions!.engine!.nested!;
export const PROJECTILE_CUSTOM_ENGINE_FIELDS = schema.definitions!.customEngine!.nested!;
export function projectileSections(missile: boolean) {
  return specSections('spec-projectile', { specClass: missile ? 'missile' : 'projectile' });
}
export function projectileSpecIssues(projectile: RowData) {
  const engines = Array.isArray(projectile.engineSlots) ? projectile.engineSlots : [];
  return [
    ...specFieldsIssues(
      projectileSections(projectile.specClass === 'missile').flatMap((section) => section.fields),
      projectile,
    ),
    ...(isRowData(projectile.explosionSpec)
      ? specFieldsIssues(EXPLOSION_FIELDS, projectile.explosionSpec, 'explosionSpec.')
      : specFieldIssues({ ...schema.definitions!.explosion!, nested: undefined }, projectile.explosionSpec)),
    ...specFieldIssues(schema.definitions!.engineSlots!, projectile.engineSlots),
    ...engines.flatMap((engine, index) =>
      isRowData(engine)
        ? [
            ...specFieldsIssues(MISSILE_ENGINE_FIELDS, engine, `engineSlots[${index}].`),
            ...(engine.style === 'CUSTOM' ? specFieldsIssues(PROJECTILE_CUSTOM_ENGINE_FIELDS, engine, `engineSlots[${index}].`) : []),
          ]
        : [],
    ),
  ];
}
