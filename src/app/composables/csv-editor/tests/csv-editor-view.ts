import { ref } from 'vue';
import { useCsvEditorModel } from '@/app/composables/csv-editor/use-csv-editor-model';
import type { CsvTableTarget } from '@/shared/types';
export function csvEditorView(target: CsvTableTarget) {
  return useCsvEditorModel(ref(target)).view;
}
