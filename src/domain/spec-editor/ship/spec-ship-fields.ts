import type { RowData } from '@/shared/types';
import { isRowData } from '@/shared/lib/row-data';
import { specSections, specSchema } from '@/domain/spec-editor/spec-schemas';
import { specFieldsIssues, specFieldIssues } from '@/domain/spec-editor/spec-validation';
const schema = specSchema('spec-ship');
export const SHIP_SECTIONS = specSections('spec-ship', {});
export const SHIP_SLOT_FIELDS = schema.definitions!.slot!.nested!;
export const SHIP_ENGINE_FIELDS = schema.definitions!.engine!.nested!;
export const SHIP_CUSTOM_ENGINE_FIELDS = schema.definitions!.customEngine!.nested!;
export const SHIP_BUILTIN_FIELDS = [schema.definitions!.builtInMods!, schema.definitions!.builtInWings!];
export function shipBuiltInWeaponsSchema(slots: readonly RowData[]) {
  return {
    ...schema.definitions!.builtInWeapons!,
    nested: slots
      .filter((slot) => slot.type === 'BUILT_IN')
      .map((slot) => ({ ...schema.definitions!.builtInWeapon!, key: String(slot.id) })),
  };
}
export function shipSpecIssues(ship: RowData) {
  const slots = Array.isArray(ship.weaponSlots) ? ship.weaponSlots : [];
  const engines = Array.isArray(ship.engineSlots) ? ship.engineSlots : [];
  return [
    ...specFieldsIssues([...SHIP_SECTIONS.flatMap((section) => section.fields), ...SHIP_BUILTIN_FIELDS], ship),
    ...['weaponSlots', 'engineSlots'].flatMap((key) => specFieldIssues(schema.definitions![key]!, ship[key])),
    ...specFieldIssues(shipBuiltInWeaponsSchema(slots.filter(isRowData)), ship.builtInWeapons),
    ...slots.flatMap((slot, index) =>
      isRowData(slot)
        ? [
            ...specFieldsIssues(SHIP_SLOT_FIELDS, slot, `weaponSlots[${index}].`),
            ...(slots.findIndex((other) => isRowData(other) && other.id === slot.id) !== index
              ? [
                  {
                    severity: 'error' as const,
                    code: 'spec.slot_id_duplicate',
                    path: `weaponSlots[${index}].id`,
                    message: `武器槽 ${index + 1}：槽位 ID ${String(slot.id)} 已被使用`,
                  },
                ]
              : []),
          ]
        : [],
    ),
    ...engines.flatMap((engine, index) =>
      isRowData(engine)
        ? [
            ...specFieldsIssues(SHIP_ENGINE_FIELDS, engine, `engineSlots[${index}].`),
            ...(engine.style === 'CUSTOM' ? specFieldsIssues(SHIP_CUSTOM_ENGINE_FIELDS, engine, `engineSlots[${index}].`) : []),
          ]
        : [],
    ),
  ];
}
