import { h, ref } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { openJointEditSnapshot, submitJointEdit } from '@/orchestrators/joint-edit.orchestrator';
import JointEditConflictChoices from '@/app/components/JointEditConflictChoices.vue';
import type { JointEditDraft, JointEditPrepared, JointConflictChoice, JointEditRoot } from '@/shared/types';
import type { SaveCommandRequest } from '@/shared/runtime/command.runtime';

export function useJointEditActions(validate?: Parameters<typeof submitJointEdit>[5]) {
  const feedback = useAppFeedback();
  async function chooseConflicts(prepared: JointEditPrepared): Promise<JointConflictChoice[] | null> {
    const choices = ref<JointConflictChoice[]>(
      prepared.conflicts.map((conflict) => ({ recordKey: conflict.recordKey, path: [...conflict.path], choice: 'disk' })),
    );
    const chosen = await feedback.choose({
      title: '选择要保存的内容',
      content: () =>
        h(JointEditConflictChoices, {
          conflicts: prepared.conflicts,
          records: prepared.snapshot.records,
          choices: choices.value,
          'onUpdate:choices': (value) => (choices.value = value),
        }),
      choices: [{ label: '按选择继续保存', value: 'continue', type: 'primary' }],
      cancelText: '返回编辑',
    });
    return chosen === 'continue' ? choices.value : null;
  }
  return {
    open: (root: JointEditRoot, signal?: AbortSignal) => openJointEditSnapshot(root, feedback, signal),
    save: (draft: JointEditDraft, createOverrides: string[] = [], request?: SaveCommandRequest) =>
      submitJointEdit(draft, feedback, chooseConflicts, createOverrides, request, validate),
  };
}
