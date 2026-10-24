import { computed, reactive, ref, type EmitFn } from 'vue';
import { useEditorDocument } from '../../editors/use-editor-document';
import { useEditorFields } from '../../editors/use-editor-fields';
import type { RowData, EditContext } from '@/shared/types/index';
import { normalizeSystemSpec, systemSections, systemSpecIssues } from '@/domain/spec-editor/system/spec-system-fields';

import { useSpecProblems } from '../use-spec-problems';
import { createSystemSpec } from '@/domain/editors/spec-construction';

export interface SpecSystemEditorProps {
  systemId: string;
  system?: RowData;
  editContext: EditContext | null;
  path?: string;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  externalUpdateNotice: string;
}
export type SpecSystemEditorEvents = {
  close: [];
  'reset-requested': [];
  'save-requested': [];
  'draft-changed': [system: RowData];
  'load-external': [];
};

export function useSpecSystemEditorViewModel(props: Readonly<SpecSystemEditorProps>, emit: EmitFn<SpecSystemEditorEvents>) {
  const document = useEditorDocument({
    source: () => props.system || createSystemSpec(props.systemId),
    normalize: normalizeSystemSpec,
    context: computed(() => props.editContext),
    publish: (value) => emit('draft-changed', value),
  });
  const localSystem = document.value,
    fields = useEditorFields(document);

  const expandedSections = ref(['basic']);

  useSpecProblems(() => systemSpecIssues(localSystem.value));
  return {
    document: localSystem,
    view: reactive({ expandedSections, sections: computed(() => systemSections(localSystem.value)) }),
    actions: {
      setField: (key: string, value: RowData[string]) => {
        if (key === 'type')
          void document.command((draft) => {
            draft.type = value;
          });
        else fields.set(key, value);
      },
      removeField: (key: string) =>
        document.change((value) => {
          delete value[key];
        }),
    },
  };
}
