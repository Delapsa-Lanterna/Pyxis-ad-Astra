import { describe, expect, it } from 'vitest';
import { buildModOpeningFailure } from './load-diagnostics';

const diagnostic = {
  code: 'parse.json_syntax',
  message: 'Raw parser detail',
  location: { path: 'D:/mods/demo/demo.skin', line: 5, column: 44 },
};

describe('Mod opening diagnostics', () => {
  it('authorizes a structured recovery target using the trusted root', () => {
    const failure = buildModOpeningFailure('\\\\?\\D:\\mods\\demo', diagnostic);
    expect(failure.file).toEqual({ path: diagnostic.location.path, line: 5, column: 44 });
    expect(failure.diagnostic).toEqual(diagnostic);
    expect(buildModOpeningFailure('D:/mods/other', diagnostic).file).toBeNull();
  });
});
