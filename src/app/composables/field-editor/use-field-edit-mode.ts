import { inject, onScopeDispose, provide, ref, watch, type InjectionKey, type Ref } from 'vue';
import { useSettingsStore } from '@/stores/settings.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';
import type { EditMode } from '@/shared/types';

const fieldEditModeKey: InjectionKey<{ inputs: FieldInputs | null; mode: Readonly<Ref<EditMode>> }> = Symbol('field-edit-mode');

export function useFieldEditMode(inputs: FieldInputs | null = useFieldInputs()) {
  const inherited = inject(fieldEditModeKey, null);
  if (inherited?.inputs === inputs) return inherited.mode;
  const settings = useSettingsStore();
  const feedback = useAppFeedback();
  const mode = ref(settings.editMode);
  let disposed = false;
  let prompting = false;
  provide(fieldEditModeKey, { inputs, mode });
  watch(
    () => inputs?.targetKey.value,
    () => {
      if (!inputs?.dirty.value) mode.value = settings.editMode;
    },
  );
  watch(
    () => settings.editMode,
    async (nextMode) => {
      if (!inputs?.dirty.value) {
        mode.value = nextMode;
        return;
      }
      if (prompting) return;
      prompting = true;
      const targetKey = inputs.targetKey.value;
      try {
        const choice = await feedback.choose({
          title: nextMode === 'smart' ? '切换到增强编辑？' : '切换到纯文本编辑？',
          content: '当前控件中有尚未提交的输入，切换时将放弃这些输入：\n\n' + inputs.pending.value.map((field) => field.label).join('\n'),
          choices: [{ label: '放弃输入并切换', value: 'discard', type: 'warning' }],
          cancelText: '保留当前模式',
        });
        if (disposed || targetKey !== inputs.targetKey.value || choice !== 'discard') return;
        inputs.cancel();
        mode.value = settings.editMode;
      } catch (error) {
        feedback.error(error, '切换编辑模式失败');
      } finally {
        prompting = false;
      }
    },
  );
  onScopeDispose(() => {
    disposed = true;
  });
  return mode;
}
