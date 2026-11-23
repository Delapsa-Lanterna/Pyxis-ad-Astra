import ts from 'typescript';

/** Project contracts share a type checker over the syntax trees already parsed by the architecture collector.
 * @type {WeakMap<object, ReturnType<typeof buildFrontendTypes>>} */
const views = new WeakMap();

/** @param {import('./context.mjs').ArchitectureContext} context */
export function frontendTypes(context) {
  let view = views.get(context.frontend);
  if (!view) {
    view = buildFrontendTypes(context);
    views.set(context.frontend, view);
  }
  return view;
}

/** @param {import('./context.mjs').ArchitectureContext} context */
function buildFrontendTypes(context) {
  const options = { strict: true, target: ts.ScriptTarget.ESNext, types: [], allowNonTsExtensions: true, noEmit: true, skipLibCheck: true };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => '/';
  const read = host.getSourceFile.bind(host);
  /** @type {Map<ts.SourceFile,string>} */
  const names = new Map();
  /** @type {Map<string,{file:import('./context.mjs').ArchitectureFile, ast:ts.SourceFile}>} */
  const blocks = new Map();
  for (const file of context.frontend)
    for (const [index, { ast }] of file.syntax.scripts.entries()) {
      const name = index ? file.rel + '.' + index + '.ts' : file.rel;
      names.set(ast, name);
      blocks.set(name, { file, ast });
    }
  host.getSourceFile = (name, language, ...rest) => {
    const block = blocks.get(name.replace(/^\//, ''));
    return block ? block.ast : read(name, language, ...rest);
  };
  host.resolveModuleNames = (imports, from) =>
    imports.map((name) => {
      const target = blocks.get(from.replace(/^\//, ''))?.file.dependencies.find((edge) => edge.specifier === name)?.resolved;
      return target && blocks.has(target) ? { resolvedFileName: target, extension: ts.Extension.Ts } : undefined;
    });
  const program = ts.createProgram([...blocks.keys()], options, host);
  const checker = program.getTypeChecker();
  /** @param {ts.Node} node */
  function projectNode(node) {
    const source = program.getSourceFile(names.get(node.getSourceFile()) ?? '');
    if (!source) return;
    return node;
  }
  /** @param {ts.Node} node */
  function type(node) {
    const matched = projectNode(node);
    return matched && checker.getTypeAtLocation(matched);
  }
  return { checker, type, projectNode };
}
