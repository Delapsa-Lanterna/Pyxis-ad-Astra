import { computed, shallowRef, watch, type Ref } from 'vue';
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, Text, Transaction, type Extension } from '@codemirror/state';
import { history, invertedEffects, isolateHistory, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type { EditContext } from '@/shared/types';
import type { FieldInputs } from './field-inputs';
import { hasLongTextLine, isJavaText, javaTextFeatures, textSearchFeatures } from './text-features';

export interface TextContent {
  readonly text: Text;
  readonly endings: Text;
  readonly newline: string;
  readonly uniform: boolean;
}
const separators: Record<string, string> = { l: '\n', c: '\r\n', r: '\r' };
const codeFor = (newline: string) => (newline === '\r\n' ? 'c' : newline === '\r' ? 'r' : 'l');
export function readTextContent(source: string): TextContent {
  const endings = source.match(/\r\n|\r|\n/g) ?? [],
    newline = endings[0] ?? '\n';
  return {
    text: Text.of(source.split(/\r\n|\r|\n/)),
    endings: Text.of([endings.map(codeFor).join('')]),
    newline,
    uniform: endings.every((ending) => ending === newline),
  };
}
export function writeTextContent(value: TextContent): string {
  if (value.uniform) return value.text.sliceString(0, value.text.length, value.newline);
  const endings = value.endings.toString(),
    parts: string[] = [];
  let index = 0;
  for (const line of value.text.iterLines()) {
    parts.push(line);
    if (index < endings.length) parts.push(separators[endings[index]!]!);
    index++;
  }
  return parts.join('');
}
export const sameTextContent = (left: TextContent, right: TextContent) =>
  left === right || (left.text.eq(right.text) && left.endings.eq(right.endings));
const restoreContent = StateEffect.define<TextContent>();
// The newline map follows the same immutable transaction and undo event as the displayed text.
const contentField = StateField.define<TextContent>({
  create: (state) => ({ ...readTextContent(''), text: state.doc }),
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(restoreContent)) return { ...effect.value, text: transaction.newDoc };
    if (!transaction.docChanged) return value;
    let endings = value.endings,
      offset = 0;
    transaction.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
      const first = transaction.startState.doc.lineAt(from).number - 1,
        last = transaction.startState.doc.lineAt(to).number - 1;
      const count = inserted.lines - 1;
      if (first !== last || count) {
        endings = endings.replace(first + offset, last + offset, Text.of([codeFor(value.newline).repeat(count)]));
        offset += count - (last - first);
      }
    });
    return { ...value, text: transaction.newDoc, endings, newline: separators[endings.sliceString(0, 1)] ?? '\n' };
  },
});
export function createTextDocument(
  value: Ref<TextContent>,
  context: Readonly<Ref<EditContext | null>>,
  limit: Readonly<Ref<number>>,
  inputs: FieldInputs,
  changed?: () => void,
  path?: Readonly<Ref<string | null>>,
) {
  const capacity = new Compartment(),
    surface = new Compartment(),
    language = new Compartment();
  let extensions: Extension = [];
  let languageAttached = false;
  const createState = () =>
    EditorState.create({
      doc: value.value.text,
      extensions: [
        contentField.init(() => value.value),
        textSearchFeatures,
        language.of(languageAttached ? javaTextFeatures(path?.value, value.value.text) : []),
        EditorState.transactionExtender.of((transaction) => {
          if (!languageAttached || !transaction.docChanged || !isJavaText(path?.value)) return null;
          let replaced = false;
          transaction.changes.iterChangedRanges((from, to) => {
            replaced ||= from === 0 && to === transaction.startState.doc.length;
          });
          return replaced || hasLongTextLine(transaction.startState.doc) !== hasLongTextLine(transaction.newDoc)
            ? { effects: language.reconfigure(javaTextFeatures(path?.value, transaction.newDoc)) }
            : null;
        }),
        surface.of(extensions),
        capacity.of(history({ minDepth: limit.value, newGroupDelay: 500 })),
        invertedEffects.of((transaction) => {
          const before = transaction.startState.field(contentField),
            after = transaction.state.field(contentField);
          return before.endings === after.endings && before.newline === after.newline ? [] : [restoreContent.of(before)];
        }),
      ],
    });
  const state = shallowRef(createState());
  let transaction: Transaction | null = null,
    scroll: ReturnType<EditorView['scrollSnapshot']> | undefined;
  let pendingInput: Promise<void> | undefined, releaseInput: (() => void) | undefined, stopInput: (() => void) | undefined;
  function finishComposition() {
    stopInput?.();
    stopInput = undefined;
    releaseInput?.();
    pendingInput = undefined;
    releaseInput = undefined;
  }
  function dispatch(next: Transaction) {
    transaction = next;
    state.value = next.state;
    const content = next.state.field(contentField);
    if (!sameTextContent(value.value, content)) {
      value.value = content;
      changed?.();
    }
  }
  const stopValue = watch(
    value,
    (next) => {
      if (!sameTextContent(next, state.value.field(contentField)))
        dispatch(
          state.value.update({
            changes: state.value.doc.eq(next.text) ? undefined : { from: 0, to: state.value.doc.length, insert: next.text },
            effects: restoreContent.of(next),
            annotations: Transaction.addToHistory.of(false),
          }),
        );
    },
    { flush: 'sync' },
  );
  const stopContext = watch(
    context,
    (next) => {
      if (!next || (next.handoff !== 'save' && next.handoff !== 'identity')) {
        transaction = null;
        scroll = undefined;
        state.value = createState();
      }
    },
    { flush: 'sync' },
  );
  const stopLimit = watch(
    limit,
    (minDepth) => dispatch(state.value.update({ effects: capacity.reconfigure(history({ minDepth, newGroupDelay: 500 })) })),
    { flush: 'sync' },
  );
  const stopLanguage =
    path &&
    watch(
      () => isJavaText(path.value),
      () => {
        if (languageAttached)
          dispatch(state.value.update({ effects: language.reconfigure(javaTextFeatures(path.value, state.value.doc)) }));
      },
      { flush: 'sync' },
    );
  return {
    state,
    lightweight: computed(() => isJavaText(path?.value) && hasLongTextLine(state.value.doc)),
    dispatch,
    startComposition() {
      if (pendingInput) return;
      pendingInput = new Promise((resolve) => {
        releaseInput = resolve;
      });
      stopInput = inputs.registerFinalizer(() => pendingInput);
    },
    finishComposition,
    async waitForInput() {
      await pendingInput;
    },
    dispatchTransactions(transactions: readonly Transaction[]) {
      dispatch(transactions[transactions.length - 1]!);
    },
    get transaction() {
      return transaction;
    },
    get scroll() {
      return scroll;
    },
    set scroll(value: ReturnType<EditorView['scrollSnapshot']> | undefined) {
      scroll = value;
    },
    canUndo: computed(() => undoDepth(state.value) > 0),
    canRedo: computed(() => redoDepth(state.value) > 0),
    undo: () => undo({ state: state.value, dispatch }),
    redo: () => redo({ state: state.value, dispatch }),
    separateHistory() {
      dispatch(state.value.update({ annotations: isolateHistory.of('full') }));
    },
    configureSurface(next: Extension) {
      extensions = next;
      const effects = [surface.reconfigure(next)];
      if (!languageAttached) {
        languageAttached = true;
        effects.push(language.reconfigure(javaTextFeatures(path?.value, state.value.doc)));
      }
      dispatch(state.value.update({ effects }));
    },
    replaceSource(source: string) {
      const next = readTextContent(source);
      if (!sameTextContent(next, value.value))
        dispatch(
          state.value.update({
            changes: { from: 0, to: state.value.doc.length, insert: next.text },
            effects: restoreContent.of(next),
            annotations: [Transaction.userEvent.of('input'), isolateHistory.of('full')],
          }),
        );
    },
    locate(line: number, column = 1) {
      const found = state.value.doc.line(Math.min(Math.max(1, line), state.value.doc.lines));
      scroll = undefined;
      dispatch(
        state.value.update({
          selection: EditorSelection.cursor(Math.min(found.to, found.from + Math.max(0, column - 1))),
          scrollIntoView: true,
        }),
      );
    },
    captureContent() {
      const captured = value.value;
      return () => sameTextContent(captured, value.value);
    },
    dispose() {
      finishComposition();
      stopValue();
      stopContext();
      stopLimit();
      stopLanguage?.();
      scroll = undefined;
      transaction = null;
      state.value = EditorState.create();
    },
  };
}
export type TextDocument = ReturnType<typeof createTextDocument>;
