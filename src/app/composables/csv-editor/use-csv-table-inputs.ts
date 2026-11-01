import { inject, provide, type InjectionKey } from 'vue';
import { provideFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';
import type { CsvCellTarget, CsvTableTarget } from '@/shared/types';

interface CsvTableInputs {
  target: CsvTableTarget;
  inputs: FieldInputs;
  activate: (target: CsvCellTarget | null) => void;
  update: (target: CsvCellTarget, value: string) => void;
  range?: {
    load: (keys: string[]) => Promise<boolean>;
    update: (keys: string[], columns: string[], values: string[][]) => string[];
    revision: () => string;
    disabled: () => boolean;
    move: (keys: string[], boundary: number) => void;
    copy: (keys: string[], boundary: number) => string[];
    remove: (keys: string[]) => void;
    insert: (columns: string[], values: string[][], boundary: number) => string[];
    position: (rowKey: string, after?: boolean) => number;
  };
}

const csvTableInputsKey: InjectionKey<CsvTableInputs> = Symbol('csv-table-inputs');

export function provideCsvTableInputs(context: CsvTableInputs) {
  provide(csvTableInputsKey, context);
  provideFieldInputs(context.inputs);
}

export function useCsvTableInputs() {
  return inject(csvTableInputsKey)!;
}
