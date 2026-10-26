import {
  computed,
  getCurrentInstance,
  inject,
  nextTick,
  onScopeDispose,
  provide,
  ref,
  shallowReactive,
  type InjectionKey,
  type Ref,
} from 'vue';
import { AppError } from '@/shared/lib/errors';
import { debugLog } from './app-log-queue';
import type { FieldProblem } from '@/shared/types';

export interface FieldInput {
  key: string;
  path?: string;
  dirty: Readonly<Ref<boolean>>;
  label: string;
  validate?: () => string | null;
  commit: () => string | null;
  focus: () => void | Promise<void>;
  cancel: () => void;
}

export type FieldInputs = ReturnType<typeof createFieldInputs>;
const fieldInputsKey: InjectionKey<FieldInputs> = Symbol('field-inputs');

export function createFieldInputs(targetKey: Readonly<Ref<string | null>> = ref(null)) {
  const fields = shallowReactive(new Set<FieldInput>());
  const validators = shallowReactive(new Set<() => FieldProblem[]>());
  const documentProblems = computed(() => [...validators].flatMap((read) => read()));
  const hasDocumentValidation = computed(() => validators.size > 0);
  function registerDocumentValidation(read: () => FieldProblem[]) {
    validators.add(read);
    return () => validators.delete(read);
  }
  const finalizers = new Map<(validate: boolean) => void | boolean | Promise<void | boolean>, string | undefined>();
  const dirty = computed(() => [...fields].some((field) => field.dirty.value));
  const errors = computed(() =>
    [...fields].flatMap((field) => {
      const message = field.validate?.();
      return message ? [{ key: field.key, path: field.path, label: field.label, message }] : [];
    }),
  );
  let generation = 0;

  function register(field: FieldInput) {
    fields.add(field);
    debugLog('input.registered', () => ({ field: field.key }));
    return () => {
      debugLog('input.released', () => ({ field: field.key }));
      return fields.delete(field);
    };
  }

  function commit(prefix?: string, validate = false): Promise<boolean> | undefined {
    const matches = (key: string) => prefix === undefined || key === prefix || key.startsWith(prefix + '/');
    const pending = [...fields].filter((field) => field.dirty.value && matches(field.key));
    const finish = [...finalizers]
      .filter(([, key]) => prefix === undefined || (key !== undefined && matches(key)))
      .sort(([, left], [, right]) => Number(left === undefined) - Number(right === undefined))
      .map(
        ([finalize]) =>
          () =>
            finalize(validate),
      );
    if (pending.length === 0 && finish.length === 0) return;
    return commitPending(pending, finish);
  }

  async function commitPending(pending: FieldInput[], finish: Array<() => void | boolean | Promise<void | boolean>>) {
    const key = targetKey.value;
    const started = generation;
    for (const field of pending) {
      if (generation !== started || targetKey.value !== key) return false;
      if (!fields.has(field) || !field.dirty.value) continue;
      const error = field.commit();
      debugLog(error === null ? 'input.committed' : 'input.validation_failed', () => ({ field: field.key }));
      if (error !== null) {
        await field.focus();
        if (generation !== started || targetKey.value !== key) return false;
        throw new AppError(`${field.label}：${error}`, { action: 'commit-field-inputs' });
      }
      await nextTick();
    }
    if (generation !== started || targetKey.value !== key) return false;
    for (const finalize of finish) {
      if (generation !== started || targetKey.value !== key || (await finalize()) === false) return false;
    }
    if (generation !== started || targetKey.value !== key) return false;
    return true;
  }

  function cancel(prefix?: string) {
    debugLog('input.cancelled', () => ({ prefix: prefix ?? '', target: targetKey.value ?? '' }));
    if (prefix === undefined) generation++;
    for (const field of fields) {
      if (prefix === undefined || field.key === prefix || field.key.startsWith(`${prefix}/`)) field.cancel();
    }
  }
  function release() {
    cancel();
    fields.clear();
    finalizers.clear();
    validators.clear();
  }
  function registerFinalizer(finalize: (validate: boolean) => void | boolean | Promise<void | boolean>, key?: string) {
    finalizers.set(finalize, key);
    return () => finalizers.delete(finalize);
  }
  function dirtyDescendants(key: string) {
    return [...fields].some((field) => field.key.startsWith(key + '/') && field.dirty.value);
  }
  function captureContext() {
    const captured = generation;
    return () => captured === generation;
  }
  return {
    targetKey,
    dirty,
    errors,
    documentProblems,
    hasDocumentValidation,
    registerDocumentValidation,
    dirtyDescendants,
    register,
    registerFinalizer,
    captureContext,
    commit,
    cancel,
    release,
  };
}

export function provideFieldInputs(state = createFieldInputs()) {
  if (getCurrentInstance()) provide(fieldInputsKey, state);
  return state;
}

export function useFieldInputs() {
  return inject(fieldInputsKey, null);
}

export function registerFieldInput(field: FieldInput) {
  const state = useFieldInputs();
  if (state) onScopeDispose(state.register(field));
}
