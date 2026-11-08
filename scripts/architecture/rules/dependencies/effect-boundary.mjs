import { defineRule } from '../../diagnostics.mjs';
import { effectPaths } from '../../facts/effects.mjs';
import { rustLayer } from '../../facts/rust-classify.mjs';

export const effectBoundaryRule = defineRule('effect-boundary', '.zcode/overview.md#项目内关键链路', import.meta.url, (context, report) => {
  const reported = new Set();
  const roots = new Set(
    context.files
      .filter(
        (file) => file.role.layer === 'domain' || ['domain', 'parsers', 'project-query', 'project-cache'].includes(rustLayer(file.rel)),
      )
      .map((file) => file.rel),
  );
  for (const path of effectPaths(context, roots)) {
    const file = context.byPath.get(path.function.file);
    if (!file) continue;
    const pure = file.role.layer === 'domain' || rustLayer(file.rel) === 'domain' || rustLayer(file.rel) === 'parsers';
    const query = rustLayer(file.rel) === 'project-query';
    const cache = rustLayer(file.rel) === 'project-cache';
    if (!pure && !(query && !['read', 'scan'].includes(path.effect.kind)) && !(cache && path.effect.kind === 'scan')) continue;
    const key = [file.rel, path.function.name, path.effect.kind, path.effect.file, path.effect.line].join(':');
    if (reported.has(key)) continue;
    reported.add(key);
    const chain = path.chain.map((fn) => fn.file + ':' + fn.line + ':' + fn.column + ' ' + fn.name).join(' -> ');
    report(file, path.function, 'function capabilities must follow their architecture role: ' + chain + ' -> ' + path.effect.symbol, {
      target: path.effect.file + ':' + path.effect.line + ':' + path.effect.column,
      symbol: path.effect.symbol,
      expected: pure ? 'pure computation' : cache ? 'typed lazy cache without directory scans' : 'read-only query',
    });
  }
});
