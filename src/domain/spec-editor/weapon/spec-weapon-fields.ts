import type { RowData } from '@/shared/types';
import { isRowData } from '@/shared/lib/row-data';
import { specSchema, specSections } from '@/domain/spec-editor/spec-schemas';
import { specFieldsIssues, specFieldIssues } from '@/domain/spec-editor/spec-validation';
const schema = specSchema('spec-weapon');
export const WEAPON_OBJECT_FIELDS = {
  muzzleFlashSpec: schema.definitions!.muzzleFlashSpec!.nested!,
  smokeSpec: schema.definitions!.smokeSpec!.nested!,
};
export function weaponSections(weapon: RowData) {
  return specSections('spec-weapon', weapon);
}
export function weaponSpecIssues(weapon: RowData) {
  return [
    ...specFieldsIssues(
      weaponSections(weapon).flatMap((section) => section.fields),
      weapon,
    ),
    ...schema.definitions!.save!.nested!.slice(1).flatMap((field) => specFieldIssues(field, weapon[field.key])),
    ...Object.entries(WEAPON_OBJECT_FIELDS).flatMap(([key, fields]) =>
      isRowData(weapon[key])
        ? specFieldsIssues(fields, weapon[key], `${key}.`)
        : specFieldIssues({ ...schema.definitions![key]!, nested: undefined }, weapon[key]),
    ),
  ];
}
