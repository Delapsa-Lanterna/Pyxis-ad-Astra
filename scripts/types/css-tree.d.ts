declare module 'css-tree' {
  interface Location {
    start: { line: number; column: number; offset: number };
    end: { line: number; column: number; offset: number };
  }
  interface NodeBase {
    loc?: Location | null;
  }
  interface List<T> extends Iterable<T> {
    first: T | null;
    toArray(): T[];
  }
  export interface Declaration extends NodeBase {
    type: 'Declaration';
    property: string;
    value: Value;
  }
  interface Rule extends NodeBase {
    type: 'Rule';
    prelude: SelectorList | { type: 'Raw' };
    block: Block;
  }
  interface Atrule extends NodeBase {
    type: 'Atrule';
    name: string;
    prelude: AtrulePrelude | null;
  }
  interface AtrulePrelude extends NodeBase {
    type: 'AtrulePrelude';
    children: List<CssNode>;
  }
  interface LiteralNode extends NodeBase {
    type: 'String' | 'Url' | 'Operator';
    value: string;
  }
  interface SelectorList extends NodeBase {
    type: 'SelectorList';
    children: List<Selector>;
  }
  export interface Selector extends NodeBase {
    type: 'Selector';
    children: List<CssNode>;
  }
  interface Block extends NodeBase {
    type: 'Block';
    children: List<CssNode>;
  }
  interface Value extends NodeBase {
    type: 'Value';
    children: List<CssNode>;
  }
  interface FunctionNode extends NodeBase {
    type: 'Function';
    name: string;
    children: List<CssNode>;
  }
  interface Identifier extends NodeBase {
    type: 'Identifier';
    name: string;
  }
  interface ClassSelector extends NodeBase {
    type: 'ClassSelector';
    name: string;
  }
  interface PseudoClassSelector extends NodeBase {
    type: 'PseudoClassSelector';
    name: string;
    children: List<SelectorList>;
  }
  interface Dimension extends NodeBase {
    type: 'Dimension';
    value: string;
    unit: string;
  }
  interface OtherNode extends NodeBase {
    type: 'StyleSheet' | 'Raw' | 'Number' | 'Percentage' | 'Hash' | 'Combinator';
  }
  export type CssNode =
    | Declaration
    | Rule
    | Atrule
    | AtrulePrelude
    | LiteralNode
    | SelectorList
    | Selector
    | Block
    | Value
    | FunctionNode
    | Identifier
    | ClassSelector
    | PseudoClassSelector
    | Dimension
    | OtherNode;
  export function parse(source: string, options: { context: 'selector' }): Selector;
  interface ParseError extends Error {
    line: number;
    column: number;
    offset: number;
  }
  export function parse(
    source: string,
    options?: { context?: string; positions?: boolean; parseCustomProperty?: boolean; onParseError?: (error: ParseError) => void },
  ): CssNode;
  export const lexer: { matchProperty(property: string, value: CssNode): { error: Error | null } };
  export function generate(node: CssNode): string;
  export function walk<T extends CssNode['type']>(
    node: CssNode,
    options: { visit: T; enter: (node: Extract<CssNode, { type: T }>) => void },
  ): void;
}
