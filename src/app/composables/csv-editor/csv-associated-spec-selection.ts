import { h, ref } from 'vue';
import type { AppFeedback, AssociatedSpecWrite } from '@/shared/types';
import type { AssociatedSpecCandidate } from '@/domain/csv-editor/associated-spec-candidates';

export async function selectCsvAssociatedSpecs(
  feedback: AppFeedback,
  candidates: AssociatedSpecCandidate[],
): Promise<AssociatedSpecWrite[] | null> {
  const { default: AssociatedSpecSaveDialog } = await import('@/app/components/AssociatedSpecSaveDialog.vue');
  const choices = ref(candidates);
  const warning = candidates.some(
    ({ change, preparation, mode }) =>
      change.action !== 'delete' &&
      (preparation!.destination.version.fingerprint ||
        preparation!.original?.problem ||
        (change.create.kind === 'weapon' &&
          mode !== 'read' &&
          !(preparation!.original?.version.fingerprint && !preparation!.original.problem))),
  );
  const selectedKeys = ref(
    new Set(
      candidates
        .filter(
          (candidate) =>
            !candidate.preparation?.destination.version.fingerprint ||
            !candidate.preparation.destination.problem ||
            (candidate.preparation.original?.version.fingerprint && !candidate.preparation.original.problem),
        )
        .map((candidate) => candidate.key),
    ),
  );
  const choice = await feedback.choose({
    title: '保存 CSV？',
    type: warning ? 'warning' : 'info',
    content: () =>
      h(AssociatedSpecSaveDialog, {
        candidates: choices.value,
        selectedKeys: selectedKeys.value,
        'onUpdate:candidates': (value) => {
          choices.value = value;
        },
        onSelect: (key, checked) => {
          if (checked) selectedKeys.value.add(key);
          else selectedKeys.value.delete(key);
        },
      }),
    choices: [
      {
        label: '保存',
        value: 'save',
        type: warning ? 'warning' : 'primary',
      },
    ],
    cancelText: '返回编辑',
  });
  if (choice !== 'save') return null;
  return choices.value
    .filter((candidate) => selectedKeys.value.has(candidate.key))
    .map((candidate) => ({
      change: candidate.change,
      target: candidate.preparation!.target,
      resolution:
        candidate.change.action === 'delete'
          ? null
          : {
              mode: candidate.mode!,
              original: candidate.preparation!.original,
              destination: candidate.preparation!.destination,
            },
    }));
}
