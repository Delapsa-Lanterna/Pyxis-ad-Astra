import ts from 'typescript';

/** @typedef {{checked:Set<number>, ended:Set<number>, values:Map<string,Set<number>>, alive:boolean}} FlowState */
/** @typedef {{line:number,column:number,message:string,expected:string}} FlowFailure */

/** @param {ts.SourceFile} ast @param {readonly import('./read-tickets.mjs').ReadTicketLifecycle[]} tickets @param {import('./read-ticket-protocol.mjs').ReadTicketProtocol} protocol @param {(node:ts.Node)=>string} pathOf @param {(node:ts.Node)=>{line:number,column:number}} at @param {ts.TypeChecker} checker @param {import('./context.mjs').ArchitectureFile} file @returns {FlowFailure[]} */
export function ticketFlowFailures(ast, tickets, protocol, pathOf, at, checker, file) {
  /** @type {FlowFailure[]} */
  const failures = [];
  const reported = new Set();
  /** @param {Iterable<number>[]} values */
  const union = (...values) => new Set(values.flatMap((value) => [...value]));
  /** @param {FlowState} state @returns {FlowState} */
  const clone = (state) => ({
    checked: new Set(state.checked),
    ended: new Set(state.ended),
    values: new Map(state.values),
    alive: state.alive,
  });
  /** @param {ts.Node} node @param {(node:ts.Node)=>void} action */
  function visit(node, action) {
    action(node);
    ts.forEachChild(node, (child) => visit(child, action));
  }
  /** @param {ts.Node} node */
  function owners(node) {
    const value = pathOf(node);
    return new Set(tickets.flatMap((ticket, index) => ([...ticket.handles].some((handle) => handle === value) ? [index] : [])));
  }
  /** @param {ts.Node} node @param {Set<ts.Node>} [seen] @returns {Set<number>} */
  function promises(node, seen = new Set()) {
    if (seen.has(node)) return new Set();
    seen.add(node);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))
      return promises(node.expression, seen);
    if (ts.isPropertyAccessExpression(node) && protocol.promises.has(node.name.text)) return owners(node.expression);
    if (ts.isIdentifier(node)) {
      const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return promises(declaration.initializer, seen);
    }
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression) && ['then', 'catch', 'finally'].includes(node.expression.name.text))
        return promises(node.expression.expression, seen);
      return union(...node.arguments.map((argument) => promises(argument, seen)));
    }
    return new Set();
  }
  /** @param {ts.Node} node @param {Iterable<number>} values @param {FlowState} state */
  function publish(node, values, state) {
    for (const ticket of values)
      if (!state.checked.has(ticket) || state.ended.has(ticket)) {
        const position = at(node),
          key = ticket + ':' + position.line + ':' + position.column;
        if (reported.has(key)) continue;
        reported.add(key);
        failures.push({
          ...position,
          message: 'read results must pass their own current check on every publication path',
          expected: 'current ticket before result publication',
        });
      }
  }
  /** @param {ts.Node} node @param {ts.Node} scope */
  function local(node, scope) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent === scope) return true;
      if (ts.isFunctionLike(parent) || ts.isSourceFile(parent)) return false;
    }
    return false;
  }
  /** @param {ts.Expression} expression @returns {ts.FunctionLikeDeclaration | undefined} */
  function callable(expression) {
    const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
    if (declaration && ts.isFunctionDeclaration(declaration)) return declaration;
    if (
      declaration &&
      ts.isVariableDeclaration(declaration) &&
      declaration.initializer &&
      (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
    )
      return declaration.initializer;
    return undefined;
  }
  /** @param {FlowState} target @param {FlowState[]} states */
  function merge(target, states) {
    const live = states.filter((state) => state.alive);
    target.alive = live.length > 0;
    if (!live.length) return;
    const first = /** @type {FlowState} */ (live[0]);
    target.checked = new Set([...first.checked].filter((ticket) => live.every((state) => state.checked.has(ticket))));
    target.ended = new Set([...first.ended].filter((ticket) => live.every((state) => state.ended.has(ticket))));
    for (const state of live) for (const [key, value] of state.values) target.values.set(key, union(target.values.get(key) ?? [], value));
  }
  /** @param {ts.Node} node @param {FlowState} state @param {ts.Node} scope @param {Set<ts.Node>} active @returns {Set<number>} */
  function expression(node, state, scope, active) {
    if (!state.alive) return new Set();
    if (ts.isAwaitExpression(node)) {
      const value = union(promises(node.expression), expression(node.expression, state, scope, active));
      state.checked.clear();
      return value;
    }
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const value = state.values.get(pathOf(node));
      if (value) return value;
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
        return expression(node.expression, state, scope, active);
      return new Set();
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      run(node, clone(state), active);
      return new Set();
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const value = expression(node.right, state, scope, active);
      const key = pathOf(node.left);
      if (key) state.values.set(key, value);
      let base = node.left;
      while (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base)) base = base.expression;
      const declaration = checker.getSymbolAtLocation(base)?.valueDeclaration;
      if (!declaration || !local(declaration, scope)) publish(node, value, state);
      if (base !== node.left && pathOf(base)) state.values.set(pathOf(base), union(state.values.get(pathOf(base)) ?? [], value));
      return value;
    }
    if (ts.isConditionalExpression(node)) {
      expression(node.condition, state, scope, active);
      const left = clone(state),
        right = clone(state),
        value = union(expression(node.whenTrue, left, scope, active), expression(node.whenFalse, right, scope, active));
      merge(state, [left, right]);
      return value;
    }
    if (
      ts.isBinaryExpression(node) &&
      [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(
        node.operatorToken.kind,
      )
    ) {
      const value = expression(node.left, state, scope, active),
        right = clone(state),
        skipped = clone(state);
      const other = expression(node.right, right, scope, active);
      merge(state, [right, skipped]);
      return union(value, other);
    }
    if (ts.isCallExpression(node)) {
      const access = ts.isPropertyAccessExpression(node.expression) ? node.expression : undefined;
      if (access && (protocol.checks.has(access.name.text) || protocol.invalidations.has(access.name.text))) {
        for (const ticket of owners(access.expression)) {
          if (protocol.checks.has(access.name.text)) {
            if (state.ended.has(ticket)) state.alive = false;
            else state.checked.add(ticket);
          } else {
            state.ended.add(ticket);
            state.checked.delete(ticket);
          }
        }
        return new Set();
      }
      const promise = access ? promises(access.expression) : new Set();
      const values = node.arguments.map((argument) =>
        ts.isArrowFunction(argument) || ts.isFunctionExpression(argument) ? new Set() : expression(argument, state, scope, active),
      );
      const called = callable(node.expression);
      if (called && !active.has(called)) {
        const next = clone(state);
        called.parameters.forEach((parameter, index) => next.values.set(pathOf(parameter.name), values[index] ?? new Set()));
        const result = run(called, next, active, false);
        state.checked = next.checked;
        return result;
      }
      const imported = ts.isIdentifier(node.expression) ? file.referenceBindings.get(node.expression.text) : undefined;
      const cleanup = imported?.edge.resolved === 'vue' && ['onScopeDispose', 'onUnmounted'].includes(imported.binding.importedName ?? '');
      for (const [argumentIndex, argument] of node.arguments.entries())
        if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
          const next = clone(state);
          if (promise.size) {
            next.checked.clear();
            if (access?.name.text === 'then' && argumentIndex === 0 && argument.parameters[0])
              next.values.set(pathOf(argument.parameters[0].name), promise);
          }
          /** @type {FlowState[]} */
          const exits = [];
          if (cleanup) next.ended.clear();
          run(argument, next, active, true, exits);
          if (cleanup) {
            const expected = new Set();
            visit(argument, (child) => {
              if (
                ts.isCallExpression(child) &&
                ts.isPropertyAccessExpression(child.expression) &&
                protocol.invalidations.has(child.expression.name.text)
              )
                for (const ticket of owners(child.expression.expression)) expected.add(ticket);
            });
            for (const ticket of expected)
              if (exits.some((exit) => !exit.ended.has(ticket)))
                failures.push({
                  ...at(argument),
                  message: 'release callbacks must revoke their owned ticket on every exit path',
                  expected: 'ticket revocation on every release path',
                });
          }
        }
      const symbol = node.expression.getText(ast);
      let base = node.expression;
      while (ts.isPropertyAccessExpression(base)) base = base.expression;
      const pure =
        /^(?:String|Number|Boolean|JSON\.stringify|Object\.(?:keys|values|entries)|Math\.[A-Za-z]+)$/.test(symbol) &&
        !checker.getSymbolAtLocation(base)?.valueDeclaration;
      if (!promise.size && !pure) publish(node, union(...values), state);
      return union(...values);
    }
    /** @type {Set<number>[]} */
    const values = [];
    ts.forEachChild(node, (child) => {
      values.push(expression(child, state, scope, active));
    });
    return union(...values);
  }
  /** @param {ts.Statement} node @param {FlowState} state @param {ts.Node} scope @param {Set<ts.Node>} active @param {boolean} exposes @param {FlowState[]} exits @param {Set<number>} result */
  function statement(node, state, scope, active, exposes, exits, result) {
    if (!state.alive) return;
    if (ts.isBlock(node)) {
      for (const child of node.statements) statement(child, state, scope, active, exposes, exits, result);
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations)
        if (declaration.initializer) state.values.set(pathOf(declaration.name), expression(declaration.initializer, state, scope, active));
      return;
    }
    if (ts.isIfStatement(node)) {
      expression(node.expression, state, scope, active);
      const left = clone(state),
        right = clone(state);
      statement(node.thenStatement, left, scope, active, exposes, exits, result);
      if (node.elseStatement) statement(node.elseStatement, right, scope, active, exposes, exits, result);
      merge(state, [left, right]);
      return;
    }
    if (ts.isReturnStatement(node)) {
      const value = node.expression ? expression(node.expression, state, scope, active) : new Set();
      for (const ticket of value) result.add(ticket);
      if (exposes) publish(node, value, state);
      exits.push(clone(state));
      state.alive = false;
      return;
    }
    if (ts.isThrowStatement(node)) {
      expression(node.expression, state, scope, active);
      exits.push(clone(state));
      state.alive = false;
      return;
    }
    if (ts.isTryStatement(node)) {
      /** @type {FlowState[]} */
      const branches = [];
      const completed = clone(state);
      statement(node.tryBlock, completed, scope, active, exposes, branches, result);
      const failed = clone(state);
      failed.checked.clear();
      if (node.catchClause) statement(node.catchClause.block, failed, scope, active, exposes, branches, result);
      merge(state, [completed, failed]);
      if (node.finallyBlock) {
        if (state.alive) statement(node.finallyBlock, state, scope, active, exposes, exits, result);
        for (const branch of branches) {
          branch.alive = true;
          statement(node.finallyBlock, branch, scope, active, exposes, exits, result);
          if (branch.alive) exits.push(branch);
        }
      } else exits.push(...branches);
      return;
    }
    if (ts.isSwitchStatement(node)) {
      expression(node.expression, state, scope, active);
      const branches = node.caseBlock.clauses.map((clause) => {
        const branch = clone(state);
        for (const child of clause.statements) {
          if (ts.isBreakStatement(child)) break;
          statement(child, branch, scope, active, exposes, exits, result);
        }
        return branch;
      });
      if (!node.caseBlock.clauses.some((clause) => ts.isDefaultClause(clause))) branches.push(clone(state));
      merge(state, branches);
      return;
    }
    if (ts.isForOfStatement(node) || ts.isForStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      const body = clone(state);
      statement(node.statement, body, scope, active, exposes, exits, result);
      return;
    }
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) return;
    expression(node, state, scope, active);
  }
  /** @param {ts.FunctionLikeDeclaration} fn @param {FlowState} state @param {Set<ts.Node>} active @param {boolean} [exposes] @param {FlowState[]} [exits] @returns {Set<number>} */
  function run(fn, state, active, exposes = true, exits = []) {
    if (active.has(fn) || !fn.body) return new Set();
    const next = new Set(active).add(fn),
      result = new Set();
    if (ts.isBlock(fn.body)) statement(fn.body, state, fn, next, exposes, exits, result);
    else {
      const value = expression(fn.body, state, fn, next);
      for (const ticket of value) result.add(ticket);
      if (exposes) publish(fn.body, value, state);
    }
    if (state.alive) exits.push(clone(state));
    return result;
  }
  visit(ast, (node) => {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node))
      run(node, { checked: new Set(), ended: new Set(), values: new Map(), alive: true }, new Set());
  });
  const top = { checked: new Set(), ended: new Set(), values: new Map(), alive: true };
  for (const node of ast.statements) statement(node, top, ast, new Set(), true, [], new Set());
  return failures;
}
