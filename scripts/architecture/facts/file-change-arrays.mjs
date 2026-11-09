import { importedTypeOrigins } from './imports.mjs';

/** @param {import('./context.mjs').ArchitectureFile} file @param {ReadonlyMap<string,import('./context.mjs').ArchitectureFile>} files */
export function formalFileChangeArrays(file, files) {
  return file.frontend.emptyTypedArrays.filter((array) => {
    return importedTypeOrigins(file, array.elementType.trim(), files).some(
      (origin) => origin.name === 'FileChangeRecord' && origin.rel === 'src/shared/types/file-changes.types.ts',
    );
  });
}
