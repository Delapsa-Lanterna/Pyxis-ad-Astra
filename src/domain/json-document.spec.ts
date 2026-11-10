import { describe, expect, it } from 'vitest';
import { createJsonDocument } from './json-document';
import { generatedTarget, prepareValue } from '@/domain/schema/game-number';
import type { JsonFileContent, FileValue } from '@/shared/types';

function document(content: FileValue, source = '{}'): JsonFileContent {
  return {
    content,
    source,
    original: {
      root: 0,
      nodes: [{ span: { start: 0, end: new TextEncoder().encode(source).length }, kind: { kind: 'object', value: [] } }],
    },
  };
}
const sample = (): FileValue => ({
  kind: 'object',
  value: [
    ['title', { kind: 'text', value: 'before' }],
    [
      'items',
      {
        kind: 'array',
        value: [
          { kind: 'float', value: '3ff0000000000000' },
          { kind: 'float', value: '3ff0000000000000' },
        ],
      },
    ],
  ],
});
describe('exact file document ownership', () => {
  it('retains a long UTF-16 key and its source through an unrelated edit and history acceptance', () => {
    const key = [...Array<number>(140000).fill(97), 0xd800];
    const content: FileValue = {
      kind: 'object',
      value: [
        [key, { kind: 'text', value: 'untouched' }],
        ['title', { kind: 'text', value: 'before' }],
      ],
    };
    const owner = createJsonDocument(document(content));
    const projected = owner.projection as Record<string, string>;
    owner.update({ ...projected, title: 'saved' }, prepareValue);
    const captured = owner.capture('preserveStructure');
    owner.replace(['title'], prepareValue('later'));
    owner.accept(captured, document(captured.request.content));
    expect(owner.node([key]).source).toEqual([key]);
    expect(owner.capture('expanded').request.content.kind === 'object').toBe(true);
    owner.undo();
    expect(owner.dirty).toBe(false);
    owner.redo();
    expect((owner.projection as Record<string, string>).title).toBe('later');
    expect(owner.node([key]).content).toEqual({ kind: 'text', value: 'untouched' });
  });
  it('rebases shared history while retaining edits after successive saves', () => {
    const owner = createJsonDocument(document(prepareValue({ a: 0, b: 0 }).value));
    owner.replace(['a'], prepareValue(1));
    const first = owner.capture('preserveStructure');
    owner.replace(['b'], prepareValue(2));
    owner.replace(['a'], prepareValue(3));
    owner.accept(first, document(first.request.content));
    owner.undo();
    expect(owner.projection).toEqual({ a: 1, b: 2 });
    owner.undo();
    expect(owner.dirty).toBe(false);
    owner.redo();
    const second = owner.capture('expanded');
    owner.accept(second, document(second.request.content));
    expect(owner.dirty).toBe(false);
    owner.redo();
    expect(owner.projection).toEqual({ a: 3, b: 2 });
  });
  it('keeps text keys distinct from UTF-16 unit keys when accepting reordered members', () => {
    const first: FileValue = { kind: 'text', value: 'first' },
      second: FileValue = { kind: 'text', value: 'second' };
    const owner = createJsonDocument(
      document({
        kind: 'object',
        value: [
          ['[55296]', first],
          [[0xd800], second],
        ],
      }),
    );
    const textId = owner.node(['[55296]']).id,
      unitsId = owner.node([[0xd800]]).id;
    owner.accept(
      owner.capture('preserveStructure'),
      document({
        kind: 'object',
        value: [
          [[0xd800], second],
          ['[55296]', first],
        ],
      }),
    );
    expect(owner.node(['[55296]']).id).toBe(textId);
    expect(owner.node([[0xd800]]).id).toBe(unitsId);
  });
  it('reads UTF-8 source spelling from each accepted and reloaded baseline', () => {
    const owner = createJsonDocument(document(prepareValue('星').value, "'星'"));
    expect(owner.raw([])).toBe("'星'");
    owner.replace([], prepareValue('月'));
    owner.accept(owner.capture('preserveStructure'), document(prepareValue('月').value, '"月"'));
    expect(owner.raw([])).toBe('"月"');
    owner.reload(document(prepareValue('银河').value, "'银河'"));
    expect(owner.raw([])).toBe("'银河'");
  });
  it('retains duplicate identities through explicit moves, value edits and deletion', () => {
    const owner = createJsonDocument(document(prepareValue([1, 1, 2]).value));
    const ids = [0, 1, 2].map((index) => owner.node([String(index)]).id);
    owner.reorder([], [0, 2, 1]);
    owner.replace(['0'], prepareValue(3));
    expect([0, 1, 2].map((index) => owner.node([String(index)]).id)).toEqual([ids[0], ids[2], ids[1]]);
    owner.spliceArray([], 1, 1, []);
    expect([0, 1].map((index) => owner.node([String(index)]).id)).toEqual([ids[0], ids[1]]);
  });
  it('keeps a map value and its source when renaming the entry', () => {
    const owner = createJsonDocument(document(prepareValue({ first: 1, second: 2 }).value));
    const id = owner.node(['first']).id;
    owner.spliceObject([], 0, 1, [['renamed', owner.prepared(['first'])]]);
    expect(owner.node(['renamed']).id).toBe(id);
    expect(owner.node(['renamed']).source).toEqual(['first']);
    expect(owner.capture('preserveStructure').edits).toEqual([
      {
        kind: 'objectSplice',
        path: [],
        index: 0,
        delete: 1,
        insert: [['renamed', { value: prepareValue(1).value, target: { source: ['first'], output: 'value', children: null } }]],
      },
    ]);
    owner.undo();
    expect(owner.node(['first']).id).toBe(id);
  });
  it('matches receipt objects by key while retaining later virtual-source edits', () => {
    const source = document(prepareValue({ title: 'before' }).value);
    const owner = createJsonDocument(source, {
      filePath: ['descriptor'],
      value: prepareValue({
        list: { mission: 'entry' },
        descriptor: {},
        text: { content: 'body' },
      }).value,
    });
    owner.replace(['descriptor', 'title'], prepareValue('saved'));
    const captured = owner.capture('preserveStructure');
    owner.replace(['list', 'mission'], prepareValue('later'));
    owner.accept(
      captured,
      document(captured.request.content),
      prepareValue({
        descriptor: { title: 'saved' },
        text: { content: 'body' },
        list: { mission: 'entry' },
      }).value,
    );
    expect(owner.projection).toEqual({ descriptor: { title: 'saved' }, text: { content: 'body' }, list: { mission: 'later' } });
  });
  it('prepares only changed business values while retaining exact untouched source values', () => {
    const input: FileValue = {
      kind: 'object',
      value: [
        ['count', { kind: 'integer', value: '9007199254740993' }],
        ['weight', { kind: 'float', value: '3ff0000000000000' }],
        ['caption', { kind: 'text', value: 'before' }],
      ],
    };
    const owner = createJsonDocument(document(input));
    const prepared: string[][] = [];
    owner.update({ ...(owner.projection as Record<string, string | number>), caption: 'after' }, (value, path) => {
      prepared.push(path);
      return prepareValue(value);
    });
    expect(prepared).toEqual([['caption']]);
    const result = owner.capture('expanded').request;
    expect(result.content.kind === 'object' && result.content.value.slice(0, 2)).toEqual(input.value.slice(0, 2));
    expect(result.target.children?.kind === 'object' && result.target.children.items[0]?.[1].source).toEqual(['count']);
  });
  it('carries nested requested formats into inserted objects', () => {
    const owner = createJsonDocument(document({ kind: 'array', value: [] }, '[]'));
    owner.spliceArray([], 0, 0, [
      {
        value: { kind: 'object', value: [['weight', { kind: 'float', value: '4000000000000000' }]] },
        target: { ...generatedTarget(), children: { kind: 'object', items: [['weight', generatedTarget('float')]] } },
      },
    ]);
    expect(owner.node(['0', 'weight']).output).toBe('float');
  });
  it('restores a baseline node when the edited value is restored', () => {
    const owner = createJsonDocument(document(sample()));
    owner.replace(['title'], prepareValue('after'));
    expect(owner.dirty).toBe(true);
    owner.replace(['title'], prepareValue('before'));
    expect(owner.dirty).toBe(false);
    expect(owner.root).toBe(owner.state.baseline);
  });
  it('keeps distinct identities for equal array values', () => {
    const owner = createJsonDocument(document(sample()));
    const first = owner.node(['items', '0']).id,
      second = owner.node(['items', '1']).id;
    owner.reorder(['items'], [1, 0]);
    expect(owner.node(['items', '0']).id).toBe(second);
    expect(owner.node(['items', '1']).id).toBe(first);
    const capture = owner.capture('preserveStructure');
    expect(capture.edits).toEqual([{ kind: 'reorder', path: ['items'], order: [1, 0] }]);
    expect(capture.request.target.children?.kind).toBe('object');
    expect(owner.dirty).toBe(true);
    owner.undo();
    expect(owner.dirty).toBe(false);
    owner.redo();
    expect(owner.dirty).toBe(true);
  });
  it('applies edits made during saving to the actual result', () => {
    const owner = createJsonDocument(document(sample()));
    owner.replace(['title'], prepareValue('saved'));
    const captured = owner.capture('preserveStructure');
    owner.replace(['title'], prepareValue('later'));
    owner.accept(captured, document(captured.request.content, '{title:"saved",items:[1.0,1.0]}'));
    expect(owner.dirty).toBe(true);
    expect(owner.node(['title']).content).toEqual({ kind: 'text', value: 'later' });
    owner.undo();
    expect(owner.dirty).toBe(false);
  });
  it('retains exact integers and UTF-16 values across unrelated edits', () => {
    const input: FileValue = {
      kind: 'object',
      value: [
        ['large', { kind: 'integer', value: '9007199254740993' }],
        ['unit', { kind: 'text', value: [0xd800] }],
        ['title', { kind: 'text', value: 'before' }],
      ],
    };
    const owner = createJsonDocument(document(input));
    owner.replace(['title'], prepareValue('after'));
    const request = owner.capture('expanded').request;
    expect(request.content.kind === 'object' && request.content.value.slice(0, 2)).toEqual(input.value.slice(0, 2));
  });
  it('accepts explicit numeric formats independently of a plain number projection', () => {
    const owner = createJsonDocument(document(sample()));
    owner.replace(['title'], { value: { kind: 'float', value: '4000000000000000' }, target: generatedTarget('float') });
    expect(owner.node(['title']).output).toBe('float');
  });
  it('identifies the removed duplicate by its position', () => {
    const owner = createJsonDocument(document(sample()));
    owner.spliceArray(['items'], 1, 1, []);
    expect(owner.capture('preserveStructure').edits).toEqual([{ kind: 'arraySplice', path: ['items'], index: 1, delete: 1, insert: [] }]);
  });
  it('keeps virtual sidecars out of the file request and retains later sidecar edits', () => {
    const source = document(sample());
    const value = prepareValue({ descriptor: {}, text: { content: 'before' }, list: { mission: 'entry' } }).value;
    const owner = createJsonDocument(source, { value, filePath: ['descriptor'] });
    owner.replace(['descriptor', 'title'], prepareValue('saved'));
    const capture = owner.capture('preserveStructure');
    expect(capture.edits[0]?.path).toEqual(['title']);
    expect(capture.request.content.kind).toBe('object');
    owner.replace(['text', 'content'], prepareValue('later'));
    owner.accept(capture, document(capture.request.content));
    expect(owner.node(['text', 'content']).content).toEqual({ kind: 'text', value: 'later' });
    expect(owner.node(['list', 'mission']).content).toEqual({ kind: 'text', value: 'entry' });
    expect(owner.dirty).toBe(true);
  });
  it('records a multi-field edit as one undo step', () => {
    const owner = createJsonDocument(document(sample()));
    owner.applyAll([
      { kind: 'replace', path: ['title'], value: prepareValue('after') },
      { kind: 'arraySplice', path: ['items'], index: 1, delete: 1, insert: [] },
    ]);
    expect(owner.history.undoStack).toHaveLength(1);
    owner.undo();
    expect(owner.dirty).toBe(false);
  });
});
