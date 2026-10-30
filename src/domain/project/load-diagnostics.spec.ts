import { describe, expect, it } from 'vitest';
import { buildModOpeningFailure } from './load-diagnostics';
import { errorDiagnosticOf, AppError, extractFileReferenceFromError } from '@/shared/lib/errors';
import { modOpeningFailureNotice } from './load-diagnostics';

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
    const notice = modOpeningFailureNotice(failure);
    const wrapped = new AppError('fixture', {
      cause: new AppError('fixture', { cause: diagnostic, fileTarget: notice.diagnostic.fileTarget }),
    });
    expect(errorDiagnosticOf(wrapped).fileTarget).toEqual(notice.diagnostic.fileTarget);
    expect(extractFileReferenceFromError(wrapped)).toMatchObject({ path: diagnostic.location.path, line: 5, column: 44 });
  });
});
