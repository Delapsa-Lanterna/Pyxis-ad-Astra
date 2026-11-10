import {
  createEditSessionValue,
  createUndoStackState,
  pushUndoEntry,
  popUndoEntry,
  pushRedoEntry,
  popRedoEntry,
} from '@/domain/edit-session';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { floatValue } from '@/domain/schema/game-number';
import type { JsonValue, RowData } from '@/shared/types';
import type {
  FilePath,
  FileText,
  FileValue,
  JsonFileContent,
  JsonFileWrite,
  JsonTarget,
  OutputFormat,
  PreparedFileValue,
  SaveLayout,
  DocumentEdit,
} from '@/shared/types';

type FileScalar = Exclude<FileValue, { kind: 'object' | 'array' }>;
function textValue(value: FileText): string {
  if (typeof value === 'string') return value;
  let text = '';
  for (let index = 0; index < value.length; index += 8192) text += String.fromCharCode(...value.slice(index, index + 8192));
  return text;
}
export function projectJsonValue(value: FileValue): JsonValue {
  return projectValue(value);
}
function projectValue(input: FileValue | DocumentNode): JsonValue {
  const value = 'content' in input ? input.content : input;
  switch (value.kind) {
    case 'null':
      return null;
    case 'bool':
      return value.value;
    case 'integer':
      return Number(value.value);
    case 'float':
      return floatValue(value.value);
    case 'text':
      return textValue(value.value);
    case 'array':
      return value.value.map(projectValue);
    case 'object': {
      const result: RowData = Object.create(null);
      for (const [key, child] of value.value) {
        result[textValue(key)] = projectValue(child);
      }
      return result;
    }
  }
}
type NodeContent = FileScalar | { kind: 'array'; value: DocumentNode[] } | { kind: 'object'; value: [FileText, DocumentNode][] };
export interface DocumentNode {
  readonly id: number;
  readonly source: FilePath | null;
  readonly output: OutputFormat;
  readonly content: NodeContent;
}
interface HistoryEntry {
  before: DocumentNode;
  after: DocumentNode;
}
export interface DocumentSaveCapture {
  readonly root: DocumentNode;
  readonly request: JsonFileWrite;
  readonly edits: DocumentEdit[];
}
export interface JsonDocumentOptions {
  value?: FileValue;
  filePath?: FilePath;
  historyLimit?: number;
}

function replaceValue(root: FileValue, path: FilePath, value: FileValue): FileValue {
  const [first, ...rest] = path;
  if (first === undefined) return value;
  if (root.kind === 'object')
    return {
      kind: 'object',
      value: root.value.map(([key, child]) => [key, sameText(key, first) ? replaceValue(child, rest, value) : child]),
    };
  if (root.kind === 'array')
    return { kind: 'array', value: root.value.map((child, index) => (index === Number(first) ? replaceValue(child, rest, value) : child)) };
  throw new Error('Document file path traverses a scalar');
}

const sameText = (left: FileText, right: FileText) => stableDeepEqual(left, right);
function fieldsByKey(node?: DocumentNode): Map<string, DocumentNode> | undefined {
  // Encoded keys retain the distinction between text and UTF-16 unit arrays.
  return node?.content.kind === 'object' ? new Map(node.content.value.map(([key, child]) => [JSON.stringify(key), child])) : undefined;
}
function children(node: DocumentNode): DocumentNode[] {
  return node.content.kind === 'object'
    ? node.content.value.map(([, value]) => value)
    : node.content.kind === 'array'
      ? node.content.value
      : [];
}
function content(node: DocumentNode): FileValue {
  if (node.content.kind === 'array') return { kind: 'array', value: node.content.value.map(content) };
  if (node.content.kind === 'object') return { kind: 'object', value: node.content.value.map(([key, value]) => [key, content(value)]) };
  return node.content;
}
function target(node: DocumentNode, original: Map<number, DocumentNode>): JsonTarget {
  if (node === original.get(node.id)) return { source: node.source, output: node.output, children: null };
  return {
    source: node.source,
    output: node.output,
    children:
      node.content.kind === 'object'
        ? { kind: 'object', items: node.content.value.map(([key, child]) => [key, target(child, original)]) }
        : node.content.kind === 'array'
          ? { kind: 'array', items: node.content.value.map((child) => target(child, original)) }
          : null,
  };
}
function visit(node: DocumentNode, path: FilePath, change: (node: DocumentNode) => DocumentNode): DocumentNode {
  const [first, ...rest] = path;
  if (first === undefined) return change(node);
  if (node.content.kind === 'object') {
    const index = node.content.value.findIndex(([key]) => sameText(key, first));
    if (index < 0) throw new Error('Document field is absent');
    const fields = [...node.content.value],
      [key, child] = fields[index]!;
    const next = visit(child, rest, change);
    if (next === child) return node;
    fields[index] = [key, next];
    return { ...node, content: { kind: 'object', value: fields } };
  }
  if (node.content.kind === 'array') {
    const index = Number(first),
      before = node.content.value[index]!;
    const next = visit(before, rest, change);
    if (next === before) return node;
    const items = [...node.content.value];
    items[index] = next;
    return { ...node, content: { kind: 'array', value: items } };
  }
  throw new Error('Document path traverses a scalar');
}
function indexNodes(root: DocumentNode): Map<number, DocumentNode> {
  const result = new Map<number, DocumentNode>(),
    pending = [root];
  while (pending.length) {
    const node = pending.pop()!;
    result.set(node.id, node);
    pending.push(...children(node));
  }
  return result;
}
function replaceChildren(node: DocumentNode, change: (node: DocumentNode) => DocumentNode): DocumentNode {
  const data = node.content;
  return data.kind === 'array'
    ? { ...node, content: { kind: 'array', value: data.value.map(change) } }
    : data.kind === 'object'
      ? { ...node, content: { kind: 'object', value: data.value.map(([key, child]) => [key, change(child)]) } }
      : node;
}

function documentEdits(
  before: DocumentNode,
  after: DocumentNode,
  originals: Map<number, DocumentNode>,
  path: FilePath = [],
): DocumentEdit[] {
  if (before === after) return [];
  const prepared = (node: DocumentNode) => ({ value: content(node), target: target(node, originals) });
  if (
    before.id !== after.id ||
    before.content.kind !== after.content.kind ||
    (after.content.kind !== 'array' && after.content.kind !== 'object')
  )
    return [{ kind: 'replace', path, value: prepared(after) }];
  const object = after.content.kind === 'object';
  const old =
    before.content.kind === 'object'
      ? before.content.value.map(([key, node]) => ({ key, node }))
      : before.content.kind === 'array'
        ? before.content.value.map((node, index) => ({ key: String(index), node }))
        : [];
  const next =
    after.content.kind === 'object'
      ? after.content.value.map(([key, node]) => ({ key, node }))
      : after.content.value.map((node, index) => ({ key: String(index), node }));
  const previous = new Map(old.map((entry, index) => [entry.node.id, { ...entry, index }]));
  const wanted = new Set(next.map((entry) => entry.node.id));
  const edits: DocumentEdit[] = [];
  for (const entry of next) {
    const origin = previous.get(entry.node.id);
    if (origin && object && !sameText(origin.key, entry.key))
      edits.push({ kind: 'objectSplice', path, index: origin.index, delete: 1, insert: [[entry.key, prepared(entry.node)]] });
    else if (origin) edits.push(...documentEdits(origin.node, entry.node, originals, [...path, origin.key]));
  }
  const current = [...old];
  for (let index = current.length - 1; index >= 0; index--) {
    if (!wanted.has(current[index]!.node.id)) {
      edits.push(
        object ? { kind: 'objectSplice', path, index, delete: 1, insert: [] } : { kind: 'arraySplice', path, index, delete: 1, insert: [] },
      );
      current.splice(index, 1);
    }
  }
  next.forEach((entry, index) => {
    if (!previous.has(entry.node.id)) {
      edits.push(
        object
          ? { kind: 'objectSplice', path, index, delete: 0, insert: [[entry.key, prepared(entry.node)]] }
          : { kind: 'arraySplice', path, index, delete: 0, insert: [prepared(entry.node)] },
      );
      current.splice(index, 0, entry);
    }
  });
  const positions = new Map(current.map((entry, index) => [entry.node.id, index]));
  const order = next.map((entry) => positions.get(entry.node.id)!);
  if (order.some((index, position) => index !== position)) edits.push({ kind: 'reorder', path, order });
  return edits;
}

/** Exact file content and persistent edit nodes share one document lifetime. */
export function createJsonDocument(initial: JsonFileContent | null, options: JsonDocumentOptions = {}) {
  let sequence = 0,
    source = initial;
  const filePath = options.filePath ?? [];
  let sourceBytes: Uint8Array | null = null;
  const decoder = new TextDecoder();
  function build(value: FileValue, path: FilePath | null, previous?: DocumentNode, output: OutputFormat = 'value'): DocumentNode {
    const id = previous?.id ?? ++sequence;
    const previousFields = fieldsByKey(previous);
    const data: NodeContent =
      value.kind === 'object'
        ? {
            kind: 'object',
            value: value.value.map(([key, item]) => [key, build(item, path && [...path, key], previousFields?.get(JSON.stringify(key)))]),
          }
        : value.kind === 'array'
          ? {
              kind: 'array',
              value: value.value.map((item, index) =>
                build(
                  item,
                  path && [...path, String(index)],
                  previous?.content.kind === 'array' ? previous.content.value[index] : undefined,
                ),
              ),
            }
          : value;
    const original =
      path && filePath.every((part, index) => path[index] !== undefined && sameText(part, path[index]!))
        ? path.slice(filePath.length)
        : null;
    return { id, source: original, output, content: data };
  }
  const initialValue = initial ? replaceValue(options.value ?? initial.content, filePath, initial.content) : options.value!;
  const state = createEditSessionValue(build(initialValue, initial ? [] : null), { clone: (value) => value, equals: (a, b) => a === b });
  const history = createUndoStackState<HistoryEntry>(options.historyLimit ?? 100);
  let batching = false;
  let baselineNodes = indexNodes(state.baseline);
  function normalize(node: DocumentNode): DocumentNode {
    const baseline = baselineNodes.get(node.id);
    if (node === baseline) return node;
    const next = replaceChildren(node, normalize);
    if (baseline && stableDeepEqual(next.content, baseline.content)) return baseline;
    return next;
  }
  function commit(next: DocumentNode) {
    if (!batching) next = normalize(next);
    if (next === state.draft) return;
    const before = state.draft;
    state.setDraft(next);
    if (!batching) pushUndoEntry(history, { before, after: next });
  }
  function change(path: FilePath, apply: (node: DocumentNode) => DocumentNode) {
    commit(visit(state.draft, path, (node) => normalize(apply(node))));
  }
  function requireNode(path: FilePath): DocumentNode {
    const node = findNode(path);
    if (!node) throw new Error('Document path is absent');
    return node;
  }
  function findNode(path: FilePath): DocumentNode | undefined {
    let node: DocumentNode | undefined = state.draft;
    for (const part of path) {
      if (node?.content.kind === 'object') node = node.content.value.find(([key]) => sameText(key, part))?.[1];
      else if (node?.content.kind === 'array') node = node.content.value[Number(part)];
      else return undefined;
    }
    return node;
  }
  function buildPrepared(prepared: PreparedFileValue, previous?: DocumentNode): DocumentNode {
    const { value, target: format } = prepared;
    const previousFields = fieldsByKey(previous);
    const childFormat = (key: FileText): JsonTarget => ({
      source: format.source ? [...format.source, key] : null,
      output: 'value',
      children: null,
    });
    const data: NodeContent =
      value.kind === 'object'
        ? {
            kind: 'object',
            value: value.value.map(([key, value], index) => {
              const target = format.children?.kind === 'object' ? format.children.items[index]![1] : childFormat(key);
              const old = previousFields?.get(JSON.stringify(key));
              return [key, buildPrepared({ value, target }, old)];
            }),
          }
        : value.kind === 'array'
          ? {
              kind: 'array',
              value: value.value.map((value, index) => {
                const target = format.children?.kind === 'array' ? format.children.items[index]! : childFormat(String(index));
                const old = previous?.content.kind === 'array' ? previous.content.value[index] : undefined;
                return buildPrepared({ value, target }, old);
              }),
            }
          : value;
    return { id: previous?.id ?? ++sequence, source: format.source, output: format.output, content: data };
  }
  function raw(path: FilePath): string | null {
    const node = findNode(path);
    if (!node?.source || !source) return null;
    let id = source.original.root;
    for (const part of node.source) {
      const kind = source.original.nodes[id]!.kind;
      if (kind.kind === 'object') id = kind.value.find((field) => sameText(field.key, part))!.value;
      else if (kind.kind === 'array') id = kind.value.elements[Number(part)]!;
      else throw new Error('Source path traverses a scalar');
    }
    const span = source.original.nodes[id]!.span;
    sourceBytes ??= new TextEncoder().encode(source.source);
    return decoder.decode(sourceBytes.subarray(span.start, span.end));
  }
  return {
    state,
    history,
    get root() {
      return state.draft;
    },
    get dirty() {
      return state.dirty;
    },
    get projection() {
      return projectValue(state.draft);
    },
    node: requireNode,
    find: findNode,
    prepared(path: FilePath): PreparedFileValue {
      const node = requireNode(path);
      return { value: content(node), target: target(node, baselineNodes) };
    },
    raw,
    update(value: JsonValue, prepare: (value: JsonValue, path: string[]) => PreparedFileValue) {
      function merge(node: DocumentNode, value: JsonValue, path: string[]): DocumentNode {
        if (stableDeepEqual(projectValue(node), value)) return node;
        if (node.content.kind === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
          const prior = new Map(node.content.value.map(([key, child]) => [textValue(key), { key, child }]));
          return {
            ...node,
            content: {
              kind: 'object',
              value: Object.entries(value).map(([key, item]) => {
                const old = prior.get(key),
                  targetPath = [...path, key];
                return [old?.key ?? key, old ? merge(old.child, item, targetPath) : buildPrepared(prepare(item, targetPath))];
              }),
            },
          };
        }
        if (node.content.kind === 'array' && Array.isArray(value)) {
          const prior = node.content.value;
          return {
            ...node,
            content: {
              kind: 'array',
              value: value.map((item, index) => {
                const targetPath = [...path, String(index)];
                return prior[index] ? merge(prior[index], item, targetPath) : buildPrepared(prepare(item, targetPath));
              }),
            },
          };
        }
        return buildPrepared(prepare(value, path), node);
      }
      commit(merge(state.draft, value, []));
    },
    apply(edit: DocumentEdit) {
      switch (edit.kind) {
        case 'replace':
          this.replace(edit.path, edit.value);
          break;
        case 'arraySplice':
          this.spliceArray(edit.path, edit.index, edit.delete, edit.insert);
          break;
        case 'objectSplice':
          this.spliceObject(edit.path, edit.index, edit.delete, edit.insert);
          break;
        case 'reorder':
          this.reorder(edit.path, edit.order);
          break;
      }
    },
    applyAll(edits: DocumentEdit[]) {
      const before = state.draft;
      batching = true;
      try {
        for (const edit of edits) this.apply(edit);
      } catch (error) {
        state.setDraft(before);
        throw error;
      } finally {
        batching = false;
      }
      state.setDraft(normalize(state.draft));
      if (before !== state.draft) pushUndoEntry(history, { before, after: state.draft });
    },
    replace(path: FilePath, prepared: PreparedFileValue) {
      change(path, (node) => buildPrepared(prepared, node));
    },
    spliceArray(path: FilePath, index: number, remove: number, insert: PreparedFileValue[]) {
      change(path, (node) => {
        if (node.content.kind !== 'array') throw new Error('Array editing requires an array');
        const items = [...node.content.value];
        items.splice(index, remove, ...insert.map((item) => buildPrepared(item)));
        return { ...node, content: { kind: 'array', value: items } };
      });
    },
    spliceObject(path: FilePath, index: number, remove: number, insert: [FileText, PreparedFileValue][]) {
      change(path, (node) => {
        if (node.content.kind !== 'object') throw new Error('Object editing requires an object');
        const fields = [...node.content.value];
        const previous = remove === 1 && insert.length === 1 ? fields[index]?.[1] : undefined;
        fields.splice(index, remove, ...insert.map(([key, item]): [FileText, DocumentNode] => [key, buildPrepared(item, previous)]));
        return { ...node, content: { kind: 'object', value: fields } };
      });
    },
    reorder(path: FilePath, order: number[]) {
      change(path, (node) => {
        if (node.content.kind === 'array') {
          const items = node.content.value;
          return { ...node, content: { kind: 'array', value: order.map((i) => items[i]!) } };
        }
        if (node.content.kind === 'object') {
          const fields = node.content.value;
          return { ...node, content: { kind: 'object', value: order.map((i) => fields[i]!) } };
        }
        throw new Error('Reordering requires a collection');
      });
    },
    undo() {
      const edit = popUndoEntry(history);
      if (edit) {
        state.setDraft(edit.before);
        pushRedoEntry(history, edit);
      }
    },
    redo() {
      const edit = popRedoEntry(history);
      if (edit) {
        state.setDraft(edit.after);
        pushUndoEntry(history, edit, { clearRedo: false });
      }
    },
    capture(layout: SaveLayout): DocumentSaveCapture {
      let baseline = state.baseline,
        draft = state.draft;
      if (filePath.length) {
        visit(state.baseline, filePath, (node) => {
          baseline = node;
          return node;
        });
        visit(state.draft, filePath, (node) => {
          draft = node;
          return node;
        });
      }
      return {
        root: state.draft,
        request: { content: content(draft), target: target(draft, baselineNodes), layout },
        edits: documentEdits(baseline, draft, baselineNodes),
      };
    },
    accept(capture: DocumentSaveCapture, actual: JsonFileContent, projection?: FileValue) {
      const accepted = replaceValue(projection ?? content(capture.root), filePath, actual.content);
      const saved = build(accepted, [], capture.root),
        savedNodes = indexNodes(saved),
        captured = indexNodes(capture.root);
      // History shares immutable nodes; rebase each version once across all entries.
      const rebased = new Map<DocumentNode, DocumentNode>();
      function rebase(node: DocumentNode): DocumentNode {
        const existing = rebased.get(node);
        if (existing) return existing;
        const baseline = savedNodes.get(node.id);
        if (baseline && node === captured.get(node.id)) return baseline;
        const rebound = replaceChildren(node, rebase);
        const result =
          baseline && stableDeepEqual(rebound.content, baseline.content) ? baseline : { ...rebound, source: baseline?.source ?? null };
        rebased.set(node, result);
        return result;
      }
      const draft = rebase(state.draft);
      for (const edit of [...history.undoStack, ...history.redoStack]) {
        edit.before = rebase(edit.before);
        edit.after = rebase(edit.after);
      }
      source = actual;
      sourceBytes = null;
      baselineNodes = savedNodes;
      state.commitSaved(saved, draft);
    },
    reload(actual: JsonFileContent, projection?: FileValue) {
      source = actual;
      sourceBytes = null;
      state.loadBaseline(build(replaceValue(projection ?? actual.content, filePath, actual.content), []));
      baselineNodes = indexNodes(state.baseline);
      history.undoStack.length = 0;
      history.redoStack.length = 0;
    },
  };
}
export type JsonDocument = ReturnType<typeof createJsonDocument>;
