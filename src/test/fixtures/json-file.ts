import { prepareValue } from '@/domain/schema/game-number';
import type { JsonFileContent, JsonFileWrite, OriginalNode, OriginalMember } from '@/shared/types';
import type { JsonValue } from '@/shared/types';

export function jsonFileFixture(value: JsonValue): JsonFileContent {
  let source = '';
  const nodes: OriginalNode[] = [];
  const offset = () => new TextEncoder().encode(source).length;
  function write(value: JsonValue): number {
    const index = nodes.length,
      start = offset();
    const node: OriginalNode = { span: { start, end: start }, kind: { kind: 'scalar' } };
    nodes.push(node);
    if (Array.isArray(value)) {
      source += '[';
      const elements: number[] = [],
        separators = [];
      for (const item of value) {
        if (elements.length) {
          const start = offset();
          source += ',';
          separators.push({ start, end: offset() });
        }
        elements.push(write(item));
      }
      source += ']';
      node.kind = { kind: 'array', value: { elements, separators } };
    } else if (value !== null && typeof value === 'object') {
      source += '{';
      const fields: OriginalMember[] = [];
      for (const [key, item] of Object.entries(value)) {
        if (fields.length) {
          const start = offset();
          source += ',';
          fields.at(-1)!.separator = { start, end: offset() };
        }
        const start = offset();
        source += JSON.stringify(key);
        const end = offset();
        source += ':';
        fields.push({ key, key_span: { start, end }, value: write(item), separator: null });
      }
      source += '}';
      node.kind = { kind: 'object', value: fields };
    } else source += JSON.stringify(value);
    node.span.end = offset();
    return index;
  }
  const root = write(value);
  return { content: prepareValue(value).value, source, original: { root, nodes } };
}

export function jsonWriteFixture(value: JsonValue): JsonFileWrite {
  return { content: prepareValue(value).value, target: { source: null, output: 'value', children: null }, layout: 'preserveStructure' };
}
