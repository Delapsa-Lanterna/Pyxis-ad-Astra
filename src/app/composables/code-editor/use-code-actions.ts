import { computed, shallowRef, ref } from 'vue';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import type { Completion } from '@codemirror/autocomplete';
import { EditorView, keymap, showTooltip } from '@codemirror/view';
import { useCodeBatch } from './use-code-batch';
import type { useCodeEditor } from './use-code-editor';
import type { useCodeAnalysis } from './use-code-analysis';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { displayOffset } from '@/shared/runtime/text-document';
import { AppError } from '@/shared/lib/errors';
import type { JavaAssistance } from '@/shared/types';

const conflictLabels: Record<string, string> = {
  binary_override_contract: '该方法实现了依赖库中的方法约定，无法共同改名',
  field_name_collision: '所属类型已存在同名字段',
  inherited_field_collision: '继承关系中存在同名字段',
  local_name_collision: '变量作用范围内已存在同名变量',
  record_component_collision: '记录类型已存在同名成员',
  method_signature_collision: '所属类型已存在同名且参数相同的方法',
  type_file_collision: '目标源码文件已存在',
  method_binding_changed: '修改会改变已有调用的方法选择',
};

export function useCodeActions(
  host: ReturnType<typeof useCodeEditor>,
  analysis: ReturnType<typeof useCodeAnalysis>,
  owner: { sessionId: string; modRoot: string },
) {
  const feedback = useAppFeedback(),
    batch = useCodeBatch(host, owner),
    plan = shallowRef<JavaAssistance | null>(null);
  const name = shallowRef(''),
    choices = ref<Record<string, string>>({}),
    signature = shallowRef<JavaAssistance | null>(null),
    signaturePosition = shallowRef(0);
  async function prepare(purpose: 'imports' | 'rename') {
    const result = await analysis.assist(purpose, undefined, purpose === 'rename' ? name.value : null, choices.value);
    if (result) {
      plan.value = result;
      signature.value = null;
    }
  }
  async function apply() {
    const captured = plan.value;
    if (!captured) return;
    await batch.apply(captured, async () => {
      const checked = await analysis.assist('validate', undefined, null, {}, captured.revision);
      if (!checked) throw new AppError('预览来源已变化，请重新生成修改', { action: 'code-refactor' });
    });
    plan.value = null;
  }
  async function parameters(view?: EditorView) {
    const result = await analysis.assist('signature', view?.state.selection.main.head);
    signaturePosition.value = host.active.value?.document.state.value.selection.main.head ?? 0;
    signature.value = result;
  }
  const extensions = computed(() => [
    autocompletion({
      override: [
        async (context) => {
          const document = host.active.value;
          if (!document || document.readOnly || !document.path.value.endsWith('.java') || document.document.lightweight.value) return null;
          const result = await analysis.assist('complete', context.pos);
          if (!result || context.aborted) return null;
          const content = document.document.content.value;
          const candidates = result.candidates.filter((candidate) => candidate.from >= 0 && candidate.to >= candidate.from);
          if (!candidates.length) return null;
          return {
            from: displayOffset(content, candidates[0]?.from ?? context.pos),
            to: displayOffset(content, candidates[0]!.to),
            options: candidates.map((candidate) => ({
              label: candidate.label,
              detail: candidate.detail,
              boost: candidate.relevance,
              apply(view: EditorView, _completion: Completion, from: number, to: number) {
                view.dispatch({
                  changes: {
                    from,
                    to,
                    insert: candidate.text,
                  },
                  selection: { anchor: from + candidate.text.length },
                  userEvent: 'input.complete',
                });
              },
            })),
            validFor: /^[\p{L}\p{N}_$]*$/u,
          };
        },
      ],
    }),
    keymap.of([
      ...completionKeymap,
      {
        key: 'Mod-Shift-Space',
        run(view) {
          void parameters(view).catch((error) => feedback.error(error, '参数提示失败'));
          return true;
        },
      },
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged || update.selectionSet) signature.value = null;
    }),
    showTooltip.of(
      signature.value?.candidates.length
        ? {
            pos: signaturePosition.value,
            above: false,
            create() {
              const dom = document.createElement('div');
              dom.className = 'code-signature';
              dom.textContent =
                '参数 ' +
                (signature.value!.argument + 1) +
                '\n' +
                signature.value!.candidates.map((candidate) => candidate.label + ' ' + candidate.detail).join('\n');
              return { dom };
            },
          }
        : null,
    ),
  ]);
  const conflicts = computed(() => plan.value?.conflicts.map((code) => conflictLabels[code]) ?? []);
  return { plan, name, choices, conflicts, extensions, prepare, apply, parameters };
}
