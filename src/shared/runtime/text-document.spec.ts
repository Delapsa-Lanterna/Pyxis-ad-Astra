import { afterEach, describe, expect, it } from 'vitest';
import { shallowRef } from 'vue';
import { Transaction } from '@codemirror/state';
import type { EditContext } from '@/shared/types';
import { createFieldInputs } from './field-inputs';
import { createTextDocument, readTextContent, sameTextContent, writeTextContent, type TextDocument } from './text-document';

const documents: TextDocument[] = [];
afterEach(() => {
  for (const doc of documents.splice(0)) doc.dispose();
});
function open(source: string) {
  const value = shallowRef(readTextContent(source));
  const context = shallowRef<EditContext | null>({ targetKey: 'sample', baselineGeneration: 1, handoff: 'load' });
  const limit = shallowRef(100);
  const doc = createTextDocument(value, context, limit, createFieldInputs());
  documents.push(doc);
  return { value, context, limit, doc, raw: () => writeTextContent(value.value) };
}
describe('immutable text documents', () => {
  it('uses the current first newline for insertion and LF after the last newline is removed', () => {
    const { doc, raw } = open('a\r\nb\nc');
    doc.dispatch(doc.state.value.update({ changes: { from: 1, to: 2 } }));
    doc.dispatch(doc.state.value.update({ changes: { from: 0, insert: '\n' } }));
    expect(raw()).toBe('\nab\nc');
    doc.replaceSource('single');
    doc.dispatch(doc.state.value.update({ changes: { from: 0, insert: '\n' } }));
    expect(raw()).toBe('\nsingle');
  });
  it.each(['', '😀中文', 'a\nb\n', 'a\r\nb\r\n', 'a\rb\r', 'a\r\nb\nc\rd'])(
    'round trips %j and restores edited newline boundaries',
    (source) => {
      const { doc, raw } = open(source);
      expect(raw()).toBe(source);
      doc.dispatch(doc.state.value.update({ changes: { from: 0, to: doc.state.value.doc.length, insert: '新\n文' } }));
      expect(raw()).toBe('新' + (source.match(/\r\n|\r|\n/)?.[0] ?? '\n') + '文');
      doc.undo();
      expect(raw()).toBe(source);
      doc.redo();
      expect(raw()).toContain('新');
    },
  );
  it('keeps untouched mixed endings across multiple ranges, deletion, insertion and undo', () => {
    const { doc, raw } = open('first\r\nsecond\nthird\rfinal');
    doc.dispatch(
      doc.state.value.update({
        changes: [
          { from: 6, to: 12, insert: '中文' },
          { from: 19, insert: 'new\n' },
        ],
      }),
    );
    expect(raw()).toBe('first\r\n中文\nthird\rnew\r\nfinal');
    doc.separateHistory();
    doc.dispatch(doc.state.value.update({ changes: { from: 5, to: 6, insert: '' } }));
    expect(raw()).toBe('first中文\nthird\rnew\r\nfinal');
    doc.undo();
    expect(raw()).toBe('first\r\n中文\nthird\rnew\r\nfinal');
    doc.undo();
    expect(raw()).toBe('first\r\nsecond\nthird\rfinal');
  });
  it('groups adjacent typing within 500 ms and separates save capture without losing earlier history', () => {
    const { doc, raw } = open('');
    const type = (insert: string, time: number) =>
      doc.dispatch(
        doc.state.value.update({
          changes: { from: doc.state.value.doc.length, insert },
          annotations: [Transaction.userEvent.of('input.type'), Transaction.time.of(time)],
        }),
      );
    type('h', 1000);
    type('ello', 1200);
    doc.separateHistory();
    type('w', 1300);
    type('orld', 1400);
    doc.undo();
    expect(raw()).toBe('hello');
    doc.undo();
    expect(raw()).toBe('');
    doc.redo();
    expect(raw()).toBe('hello');
    type('!', 2100);
    type('?', 2701);
    doc.undo();
    expect(raw()).toBe('hello!');
  });
  it('retains selection and original history for save and identity, resets on external load', () => {
    const { doc, value, context, raw } = open('😀\r\nabc\rxyz');
    doc.locate(2, 3);
    expect(doc.state.value.selection.main.head).toBe(5);
    doc.replaceSource('changed');
    context.value = { ...context.value!, baselineGeneration: 2, handoff: 'save' };
    context.value = { ...context.value!, baselineGeneration: 3, handoff: 'identity' };
    expect(doc.canUndo.value).toBe(true);
    const accepts = doc.captureContent();
    doc.locate(1, 2);
    expect(accepts()).toBe(true);
    doc.replaceSource('later');
    expect(accepts()).toBe(false);
    value.value = readTextContent('external\r\n');
    context.value = { ...context.value!, baselineGeneration: 4, handoff: 'external' };
    expect(raw()).toBe('external\r\n');
    expect(doc.canUndo.value).toBe(false);
    doc.replaceSource('new');
    doc.dispose();
    expect(doc.canUndo.value).toBe(false);
    expect(doc.state.value.doc.length).toBe(0);
  });
  it('updates native history retention target while preserving redo and immutable capture', () => {
    const { doc, limit, value, raw } = open('base');
    doc.replaceSource('one');
    doc.replaceSource('two');
    doc.replaceSource('three');
    const captured = value.value;
    limit.value = 1;
    doc.undo();
    expect(raw()).toBe('two');
    doc.redo();
    expect(sameTextContent(value.value, captured)).toBe(true);
    expect(writeTextContent(captured)).toBe('three');
  });
});
