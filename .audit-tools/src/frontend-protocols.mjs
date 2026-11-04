/** Extracts project protocols after official declaration identity has been resolved.
 * @param {any[]} calls @param {any[]} functions */
export function frontendProtocols(calls, functions) {
  const semantics = new Map(),
    parameters = new Map(functions.map((fn) => [fn.id, fn.params]));
  for (const call of calls) {
    const target = call.target;
    if (!target) continue;
    const name = target.name,
      path = target.path.replaceAll('\\', '/');
    if (/(?:^|\/)node_modules\/@tauri-apps\/api\/core\.d\.ts$/.test(path) && name === 'invoke')
      semantics.set(target.id, { kind: 'ipc', argument: 0 });
    if (/(?:^|\/)node_modules\/@tauri-apps\/api\/event\.d\.ts$/.test(path) && ['emit', 'emitTo', 'listen', 'once'].includes(name))
      semantics.set(target.id, { kind: name === 'emit' || name === 'emitTo' ? 'emit' : 'listen', argument: name === 'emitTo' ? 1 : 0 });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const call of calls) {
      const semantic = semantics.get(call.target?.id),
        params = parameters.get(call.owner);
      if (!semantic || !params) continue;
      const argument = params.findIndex((/** @type {string[]} */ ids) =>
        call.args[semantic.argument]?.bindings.some((/** @type {string} */ id) => ids.includes(id)),
      );
      if (argument >= 0 && !semantics.has(call.owner)) {
        semantics.set(call.owner, { kind: semantic.kind, argument });
        changed = true;
      }
    }
  }
  const commands = [],
    events = [];
  for (const call of calls) {
    const semantic = semantics.get(call.target?.id);
    if (!semantic) continue;
    const value = call.args[semantic.argument];
    const endpoint = {
      path: call.path,
      line: call.line,
      column: call.column,
      role: semantic.kind,
      value: value?.literal ?? null,
      expression: value?.text ?? '',
      parser: 'official declaration + protocol parameter flow',
    };
    if (semantic.kind === 'ipc') commands.push(endpoint);
    else events.push(endpoint);
  }
  return { commands, events };
}
