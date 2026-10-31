import { defineRule } from '../../diagnostics.mjs';

const pathOwner = 'src-tauri/src/io/paths.rs';
const keyOwner = 'src-tauri/src/models/window.rs';

export const pathBoundaryRule = defineRule(
  'path-boundary',
  '.zcode/modules/rust-file-io-changeset.md#规范',
  import.meta.url,
  (context, report) => {
    for (const file of context.rust) {
      if (!file.rel.startsWith('src-tauri/src/') || file.rel === 'src-tauri/src/test_support.rs') continue;
      for (const call of file.rust.calls) {
        if (call.target.split('::').at(-1) === 'canonicalize' && file.rel !== pathOwner)
          report(file, call, 'disk path expansion belongs to the IO path boundary', { target: call.target, expected: pathOwner });
      }
      if ([pathOwner, keyOwner].includes(file.rel)) continue;
      for (const fn of file.rust.functions) {
        const calls = file.rust.calls.filter((call) => call.offset > fn.start + fn.signature.length && call.offset < fn.end);
        const paths = new Set(
          [...fn.signature.matchAll(/\b(\w+)\s*:\s*&(?:'\w+\s+)?(?:mut\s+)?([\w:]+)/g)]
            .filter(
              (match) =>
                /^(?:std::path::)?Path(?:Buf)?$/.test(match[2] ?? '') ||
                file.rust.references.some(
                  (edge) =>
                    edge.offset === fn.start + match.index + match[0].lastIndexOf(match[2] ?? '') &&
                    /^std::path::Path(?:Buf)?$/.test(edge.target.join('::')),
                ),
            )
            .map((match) => match[1]),
        );
        for (const call of calls) {
          const prefix = file.rust.code.slice(fn.start, call.offset);
          const operand = /\b((?:\w+\s*\.\s*)*\w+)\s*(?:\.\s*to_string_lossy\s*\(\s*\)\s*)?\.\s*$/.exec(prefix)?.[1]?.replace(/\s/g, '');
          if (
            operand &&
            ['to_lowercase', 'to_ascii_lowercase', 'eq_ignore_ascii_case'].includes(call.name) &&
            (paths.has(operand) || /(?:^|\.)(?:root|mod_root|canonical_root)$|\.path$/.test(operand))
          )
            report(file, call, 'filesystem identity comparison must consume the shared path key', {
              target: operand,
              expected: 'models::windows_path_key',
            });
          if (call.target !== 'models::windows_path_key') continue;
          const argument = call.arguments[0] ?? '';
          const raw = new Set(paths);
          for (const binding of prefix.matchAll(/\blet\s+(?:mut\s+)?(\w+)\s*(?::[^=;]+)?=([^;]+);/g)) {
            const name = /** @type {string} */ (binding[1]);
            const expression = /** @type {string} */ (binding[2]);
            const input = [...raw].find((path) => new RegExp('\\b' + path + '\\b').test(expression));
            if (!input) continue;
            const start = fn.start + binding.index;
            const expansion = calls.find(
              (candidate) =>
                candidate.offset >= start &&
                candidate.offset < start + binding[0].length &&
                ['io::canonical_path', 'io::paths::canonical_path', 'io::FsRootBoundary::new', 'io::paths::FsRootBoundary::new'].includes(
                  candidate.target,
                ) &&
                new RegExp('\\b' + input + '\\b').test(candidate.arguments[0] ?? ''),
            );
            if (expansion) raw.delete(name);
            else raw.add(name);
          }
          for (const path of raw) {
            if (new RegExp('\\b' + path + '\\b').test(argument))
              report(file, call, 'raw disk paths must be expanded before string key construction', {
                target: path,
                expected: 'io::canonical_path or FsRootBoundary',
              });
          }
        }
      }
    }
  },
);
