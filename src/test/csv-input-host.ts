import { h, ref, onScopeDispose, type Component } from 'vue';
import { mount, type MountingOptions } from '@vue/test-utils';
import { provideCsvTableInputs } from '@/app/composables/csv-editor/use-csv-table-inputs';
import { createFieldInputs } from '@/shared/runtime/field-inputs';
import { provideCsvGridMedia } from '@/app/composables/csv-editor/use-csv-grid-media';
import { resourceMediaDataUrl } from '@/services/resource-media.service';
import type { CsvCellTarget, CsvTableTarget } from '@/shared/types';

export function mountCsvInputHost(
  surface: Component,
  options: Pick<MountingOptions<Record<string, unknown>>, 'global' | 'attachTo'>,
  initialProps: Record<string, unknown>,
  target: CsvTableTarget = { sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' },
) {
  const inputs = createFieldInputs(ref(JSON.stringify(target)));
  const activeCell = ref<CsvCellTarget | null>(null);
  const updates: Array<{ target: CsvCellTarget; value: string }> = [];
  const props = ref(initialProps);
  const host = mount(
    {
      setup() {
        onScopeDispose(inputs.release);
        provideCsvGridMedia({ url: (resource) => resourceMediaDataUrl(target.sessionId, resource) ?? '' });
        provideCsvTableInputs({
          target,
          inputs,
          activate: (cell) => {
            activeCell.value = cell;
          },
          update: (cell, value) => {
            updates.push({ target: cell, value });
          },
        });
        return () => h(surface, { ...props.value, editing: activeCell.value });
      },
    },
    options,
  );
  return { host, inputs, target, props, activeCell, updates, surface: host.findComponent(surface) };
}
