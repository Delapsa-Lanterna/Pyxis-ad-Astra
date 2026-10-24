import { computed, nextTick, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import type { EditContext, RowData } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { useSnapshotHistory } from '@/app/composables/use-snapshot-history';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useEditActionContext } from '@/app/composables/use-edit-action-context';
import { registerFieldInput, useFieldInputs } from '@/shared/runtime/field-inputs';

type EditorAction =
  | { kind: 'field'; before: RowData; element: HTMLElement }
  | { kind: 'command'; before: RowData }
  | { kind: 'gesture'; before: RowData; complete: () => void };

export function useEditorDocument(options: {
  source: () => RowData;
  normalize: (source: RowData) => RowData;
  context: Readonly<Ref<EditContext | null>>;
  publish: (value: RowData) => void;
  draw?: () => void;
  reset?: (reason: EditContext['handoff'] | 'replay') => void;
  historyLimit?: Readonly<Ref<number>>;
  contains?: (element: HTMLElement) => boolean;
}) {
  const value = ref<RowData>(options.normalize(options.source()));
  const inputs = useFieldInputs();
  const history = options.historyLimit ? useSnapshotHistory<RowData>(options.context, options.historyLimit) : null;
  const { commitBefore: run } = useFieldInputActions(inputs);
  const { captureActionContext } = useEditActionContext(options.context);
  const action = shallowRef<EditorAction | null>(null);
  let committed = deepClone(value.value);

  function publish() {
    options.publish(value.value);
    options.draw?.();
  }
  function finish(publishGesture = true) {
    const current = action.value;
    if (!current) return;
    action.value = null;
    if (current.kind === 'gesture') {
      current.complete();
      if (publishGesture) publish();
    }
    history?.push(current.before, value.value);
    committed = deepClone(value.value);
  }
  function change(edit: (value: RowData) => void) {
    if (!action.value) {
      const element = document.activeElement as HTMLElement | null;
      const field = element?.matches('input, textarea') && options.contains?.(element);
      action.value = field ? { kind: 'field', before: committed, element: element! } : { kind: 'command', before: committed };
    }
    edit(value.value);
    publish();
    if (action.value?.kind === 'command') finish();
  }
  function command(edit: (value: RowData) => void) {
    return run(() => {
      finish();
      action.value = { kind: 'command', before: committed };
      change(edit);
    });
  }
  function beginGesture(complete: () => void) {
    finish();
    action.value = { kind: 'gesture', before: committed, complete };
  }
  function beginField(event: FocusEvent) {
    const element = event.target as HTMLElement;
    if (
      !element.matches('input, textarea, select, [contenteditable="true"]') ||
      (action.value?.kind === 'field' && action.value.element === element)
    )
      return;
    finish();
    action.value = { kind: 'field', before: committed, element };
  }
  function endField() {
    if (action.value?.kind === 'field') finish();
  }
  function fieldBlur() {
    const current = action.value;
    void nextTick(() => {
      if (action.value === current) endField();
    });
  }
  function fieldKey(event: KeyboardEvent) {
    if (event.key === 'Enter' && ((event.target as HTMLElement).tagName !== 'TEXTAREA' || event.ctrlKey)) endField();
  }
  function replay(direction: 'undo' | 'redo') {
    return run(() => {
      finish();
      const next = history?.[direction]();
      if (!next) return;
      value.value = options.normalize(next);
      committed = deepClone(value.value);
      options.reset?.('replay');
      publish();
    });
  }
  registerFieldInput({
    key: 'editor-action',
    label: '编辑动作',
    dirty: computed(() => action.value !== null && !stableDeepEqual(action.value.before, value.value)),
    commit: () => null,
    focus: () => {},
    cancel: () => {
      if (action.value?.kind === 'gesture') action.value.complete();
      action.value = null;
      committed = deepClone(value.value);
    },
  });
  if (inputs) onScopeDispose(inputs.registerFinalizer(() => finish()));
  watch(
    options.context,
    (context) => {
      if (context?.handoff === 'save') {
        if (!action.value && !inputs?.dirty.value) value.value = options.normalize(options.source());
      } else {
        if (action.value?.kind === 'gesture') action.value.complete();
        action.value = null;
        value.value = options.normalize(options.source());
        options.reset?.(context?.handoff ?? 'load');
      }
      committed = deepClone(value.value);
      options.draw?.();
    },
    { flush: 'post' },
  );
  function field<T>(key: string, project: (value: RowData[string] | undefined) => T, store: (value: T) => RowData[string]) {
    return computed({
      get: () => project(value.value[key]),
      set: (next) =>
        change((value) => {
          value[key] = store(next);
        }),
    });
  }
  return {
    value,
    change,
    command,
    run,
    beginGesture,
    finish,
    beginField,
    fieldBlur,
    fieldKey,
    field,
    editingField: computed(() => action.value?.kind === 'field' || Boolean(inputs?.dirty.value)),
    captureActionContext,
    undo: () => replay('undo'),
    redo: () => replay('redo'),
  };
}
