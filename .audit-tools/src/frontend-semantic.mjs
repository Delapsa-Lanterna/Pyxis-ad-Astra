import ts from 'typescript';
import { createVueLanguagePlugin, createParsedCommandLine } from '@vue/language-core';
import { proxyCreateProgram } from '@volar/typescript';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { frontendSource } from './frontend-source.mjs';
/** @typedef {{path:string,start:number|null,line:number|null,column:number|null,generatedStart:number|null,declarationScope:'augmentation'|'global'|null,valueTargets:SemanticTarget[],kind:string,name:string,id:string}} SemanticTarget */

/** Runs one official project and serializes its evidence before process exit.
 * @param {import('./model.mjs').AuditInputSnapshot} snapshot @param {string} config */
export function indexFrontendProject(snapshot, config) {
  const root = snapshot.root,
    maintained = new Map(snapshot.files.map((file) => [file.path, file]));
  const configPath = join(root, config),
    json = ts.readConfigFile(configPath, ts.sys.readFile);
  if (json.error) throw new Error(ts.flattenDiagnosticMessageText(json.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(json.config, ts.sys, dirname(configPath), undefined, configPath, undefined, [
    { extension: 'vue', isMixedContent: true, scriptKind: ts.ScriptKind.Deferred },
  ]);
  if (parsed.errors.length)
    throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  const options = { ...parsed.options, allowNonTsExtensions: true };
  /** @type {import('@volar/language-core').Language<string>} */
  let language;
  const create = proxyCreateProgram(ts, ts.createProgram, () => ({
    languagePlugins: [
      createVueLanguagePlugin(ts, options, createParsedCommandLine(ts, ts.sys, configPath.replaceAll('\\', '/')).vueOptions, (id) => id),
    ],
    setup: (value) => {
      language = value;
    },
  }));
  const program = create({
      rootNames: parsed.fileNames,
      options,
      host: ts.createCompilerHost(options, true),
      projectReferences: parsed.projectReferences,
    }),
    checker = program.getTypeChecker();
  const rel = (/** @type {string} */ value) => relative(root, value).replaceAll('\\', '/');
  /** @param {ts.SourceFile} file */
  function serviceFor(file) {
    const source = language.scripts.get(file.fileName);
    if (!source?.generated) return null;
    const service = source.generated.languagePlugin.typescript?.getServiceScript(source.generated.root);
    return service
      ? {
          source,
          service,
          map: language.maps.get(service.code, source),
          offset: service.preventLeadingOffset ? 0 : source.snapshot.getLength(),
        }
      : null;
  }
  /** @type {Map<ts.Declaration,SemanticTarget>} */
  const targetCache = new Map();
  /** @param {ts.Declaration} declaration @returns {SemanticTarget} */
  function target(declaration) {
    const cached = targetCache.get(declaration);
    if (cached) return cached;
    const file = declaration.getSourceFile(),
      service = serviceFor(file),
      name = /** @type {ts.NamedDeclaration} */ (declaration).name ?? declaration;
    const at = name.getStart(file),
      mapped = service
        ? [...service.map.toSourceLocation(at - service.offset, (data) => !!data.navigation)].map(([position]) => position)
        : [at];
    const source = maintained.get(rel(file.fileName)),
      start = mapped[0] ?? null;
    const where = file.getLineAndCharacterOfPosition(start ?? 0);
    const location = source && start !== null ? /** @type {string} */ (source.text).slice(0, start).split('\n') : null;
    const namespace = ts.findAncestor(declaration, ts.isModuleDeclaration);
    /** @type {SemanticTarget} */
    const value = {
      path: rel(file.fileName),
      start,
      line: location ? location.length : start === null ? null : where.line + 1,
      column: location ? /** @type {string} */ (location.at(-1)).length + 1 : start === null ? null : where.character + 1,
      generatedStart: service ? at : null,
      declarationScope:
        namespace &&
        (namespace.flags & ts.NodeFlags.GlobalAugmentation || (ts.isStringLiteral(namespace.name) && ts.isExternalModule(file)))
          ? 'augmentation'
          : file.isDeclarationFile && !ts.isExternalModule(file) && !(namespace && ts.isStringLiteral(namespace.name))
            ? 'global'
            : null,
      valueTargets: [],
      kind: ts.SyntaxKind[declaration.kind],
      name: name === declaration ? ts.SyntaxKind[declaration.kind] : name.getText(file),
      id: rel(file.fileName) + ':' + at,
    };
    targetCache.set(declaration, value);
    if (
      value.declarationScope === 'augmentation' &&
      ts.isPropertySignature(declaration) &&
      declaration.type &&
      ts.isTypeQueryNode(declaration.type)
    )
      value.valueTargets = declarations(checker.getSymbolAtLocation(declaration.type.exprName)).map(target);
    return value;
  }
  /** @param {ts.Symbol | undefined} symbol */
  function declarations(symbol) {
    return symbol ? ((symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol).declarations ?? []) : [];
  }
  /** @type {any[]} */
  const calls = [];
  const functions = /** @type {any[]} */ ([]),
    declarationsOut = /** @type {any[]} */ ([]);
  /** @type {any[]} */
  const records = [],
    modules = [],
    issues = [];
  const sourcePaths = [];
  for (const sf of program.getSourceFiles()) {
    const entry = maintained.get(rel(sf.fileName));
    if (!entry || !/\.(?:[cm]?[jt]sx?|vue)$/.test(entry.path)) continue;
    const file = entry,
      fileText = /** @type {string} */ (file.text);
    sourcePaths.push(file.path);
    const service = serviceFor(sf),
      nodes = new Map(),
      source = frontendSource(file);
    issues.push(...source.issues);
    /** @param {ts.Node} node */
    function index(node) {
      const start = node.getStart(sf),
        list = nodes.get(start) ?? [];
      list.push(node);
      nodes.set(start, list);
      ts.forEachChild(node, index);
      for (const doc of /** @type {ts.Node & {jsDoc?:ts.JSDoc[]}} */ (node).jsDoc ?? []) ts.forEachChild(doc, index);
    }
    index(sf);
    /** @param {number} start */
    const generated = (start) =>
      service
        ? [...service.map.toGeneratedLocation(start, (data) => !!data.navigation)].map(([position]) => position + service.offset)
        : [start];
    /** @param {ts.Node} node */
    function sourceAt(node) {
      return service
        ? [...service.map.toSourceLocation(node.getStart(sf) - service.offset, (data) => !!data.navigation)].map(([position]) => position)
        : [node.getStart(sf)];
    }
    for (const site of source.sites) {
      /** @type {ts.Declaration[]} */
      const found = [];
      let state = 'unmapped-source',
        typeText = '',
        binding = null;
      const contractTargets = [];
      let valueTypeText = '';
      for (const at of generated(site.start))
        for (const node of nodes.get(at) ?? []) {
          if (site.group === 'call') {
            if ((!ts.isCallExpression(node) && !ts.isNewExpression(node)) || (!service && node.getWidth(sf) !== site.length)) continue;
            const signature = checker.getResolvedSignature(node);
            if (signature?.declaration) found.push(signature.declaration);
            state = signature ? 'signature-without-declaration' : 'no-signature';
          } else {
            if (!ts.isIdentifier(node) && !ts.isPrivateIdentifier(node) && !(site.group === 'component' && ts.isStringLiteralLike(node)))
              continue;
            const symbol = checker.getSymbolAtLocation(node);
            found.push(...declarations(symbol));
            state = symbol ? 'symbol-without-declaration' : 'no-symbol';
            if (ts.isShorthandPropertyAssignment(node.parent))
              found.push(...declarations(checker.getShorthandAssignmentValueSymbol(node.parent)));
            if (!found.length) {
              const receiver =
                ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
                  ? node.parent.expression
                  : ts.isBindingElement(node.parent) && node.parent.propertyName === node
                    ? node.parent.parent
                    : node;
              const type = checker.getTypeAtLocation(receiver);
              typeText = checker.typeToString(type);
              valueTypeText = checker.typeToString(checker.getTypeAtLocation(node));
              const actual = checker.getNonNullableType(type),
                indexes = checker.getIndexInfosOfType(actual);
              if (type.flags & ts.TypeFlags.Any) state = 'dynamic-any';
              else if (type.flags & ts.TypeFlags.Unknown) state = 'unknown-type';
              else if (indexes.length) {
                state = 'indexed-contract';
                found.push(...declarations(actual.aliasSymbol ?? actual.symbol));
                for (const info of indexes) if (info.declaration) found.push(info.declaration);
              } else if (symbol && ['undefined', 'globalThis'].includes(symbol.name)) state = 'language-intrinsic';
              else if (symbol && symbol.flags & ts.SymbolFlags.Transient) {
                state = 'synthetic-contract';
                contractTargets.push(...declarations(actual.aliasSymbol ?? actual.symbol));
              }
              if (ts.isMetaProperty(node.parent)) state = 'language-intrinsic';
            }
            binding =
              declarations(symbol)
                .map(target)
                .map((value) => value.id)[0] ?? binding;
          }
        }
      const targets = [
        ...new Map(
          found.map((declaration) => {
            const value = target(declaration);
            return [value.id, value];
          }),
        ).values(),
      ];
      if (targets.length && state !== 'indexed-contract')
        state = targets.every((value) => value.start === null) ? 'generated-declaration' : 'declaration';
      records.push({ ...site, targets, state, typeText, valueTypeText, contractTargets: contractTargets.map(target), binding });
    }
    /** @param {ts.Node} node */
    function syntax(node) {
      const positions = sourceAt(node);
      if (positions.length) {
        if (ts.isFunctionLike(node) && 'body' in node && node.body) {
          const declaration = target(/** @type {ts.Declaration} */ (node));
          functions.push({
            id: declaration.id,
            path: file.path,
            params: node.parameters.map((parameter) =>
              declarations(checker.getSymbolAtLocation(parameter.name))
                .map(target)
                .map((value) => value.id),
            ),
          });
        }
        if (
          ts.isFunctionDeclaration(node) ||
          ts.isVariableDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node)
        ) {
          const value = target(node);
          let owner = node.parent;
          while (owner && !ts.isFunctionLike(owner) && !ts.isClassDeclaration(owner) && !ts.isModuleDeclaration(owner))
            owner = owner.parent;
          declarationsOut.push({
            path: file.path,
            line: value.line ?? 1,
            column: value.column ?? 1,
            name: node.name?.getText(sf) ?? 'default',
            scope: owner ? target(/** @type {ts.Declaration} */ (owner)).id : 'module',
            kind: ts.SyntaxKind[node.kind],
            text: /** @type {string} */ (node.getText(sf).split('\n')[0]).slice(0, 240),
            qualified: value.id,
          });
        }
      }
      if (ts.isCallExpression(node) && node.expression.kind !== ts.SyntaxKind.ImportKeyword) {
        const starts = sourceAt(node.expression);
        if (starts.length) {
          const targetDeclaration = checker.getResolvedSignature(node)?.declaration;
          let owner = node.parent;
          while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
          /** @param {ts.Expression} argument */
          const argument = (argument) => {
            const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(argument) ? argument.name : argument),
              type = checker.getTypeAtLocation(argument);
            return {
              text: argument.getText(sf),
              literal: ts.isStringLiteralLike(argument) ? argument.text : type.isStringLiteral() ? type.value : null,
              bindings: declarations(symbol)
                .map(target)
                .map((value) => value.id),
            };
          };
          const position = starts[0],
            before = fileText.slice(0, position).split('\n');
          calls.push({
            path: file.path,
            line: before.length,
            column: /** @type {string} */ (before.at(-1)).length + 1,
            owner: owner ? target(/** @type {ts.Declaration} */ (owner)).id : null,
            target: targetDeclaration ? target(targetDeclaration) : null,
            args: node.arguments.map(argument),
          });
        }
      }
      ts.forEachChild(node, syntax);
      for (const doc of /** @type {ts.Node & {jsDoc?:ts.JSDoc[]}} */ (node).jsDoc ?? []) ts.forEachChild(doc, syntax);
    }
    syntax(sf);
    for (const imported of source.imports) {
      const targetDeclarations = [];
      for (const at of generated(imported.start))
        for (const node of nodes.get(at) ?? [])
          if (ts.isStringLiteralLike(node)) targetDeclarations.push(...declarations(checker.getSymbolAtLocation(node)));
      const targets = [
        ...new Map(
          targetDeclarations.map((declaration) => {
            const value = target(declaration);
            return [value.id, value];
          }),
        ).values(),
      ];
      modules.push({ ...imported, targets });
    }
  }
  for (const diagnostic of program.getSyntacticDiagnostics())
    if (diagnostic.file && maintained.has(rel(diagnostic.file.fileName))) {
      const where = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      issues.push({
        kind: 'parse',
        path: rel(diagnostic.file.fileName),
        line: where.line + 1,
        column: where.character + 1,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        parser: 'TypeScript + Vue official syntax',
      });
    }
  return {
    config,
    roots: parsed.fileNames.map(rel),
    sourcePaths,
    records,
    modules,
    calls,
    functions,
    declarations: declarationsOut,
    issues,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, config, output] = /** @type {[string, string, string]} */ (process.argv.slice(2)),
    started = performance.now();
  const facts = indexFrontendProject(JSON.parse(gunzipSync(await readFile(input)).toString('utf8')), config);
  await writeFile(output, gzipSync(JSON.stringify(facts)));
  console.log(
    JSON.stringify({
      config,
      seconds: (performance.now() - started) / 1000,
      maxRssMiB: process.resourceUsage().maxRSS / 1024,
      records: facts.records.length,
    }),
  );
}
